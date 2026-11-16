import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import domain_cutover as domains


class DomainTests(unittest.TestCase):
    def test_only_four_public_names_use_new_certificate_and_legacy_keeps_own(self):
        config = domains.site_config()
        blocks = [piece for piece in config.split('server {') if 'listen 443 ssl;' in piece]
        self.assertEqual(len(blocks), 5)
        for block in blocks:
            host = re.search(r'server_name ([^;]+);', block)[1]
            expected = domains.LEGACY if host == domains.LEGACY else domains.FRONT
            self.assertIn(f'/live/{expected}/fullchain.pem;', block)
            if host in (domains.LEGACY, 'www.' + domains.FRONT, 'www.' + domains.API):
                target = domains.API if host == 'www.' + domains.API else domains.FRONT
                self.assertIn(f'return 308 https://{target}$request_uri;', block)
            elif host == domains.API:
                self.assertIn('location ^~ /api/', block)
                self.assertIn('location / { return 404; }', block)
            else:
                self.assertEqual(host, domains.FRONT)
                self.assertIn('location / {', block)
                self.assertIn('proxy_pass http://127.0.0.1:3102;', block)
        self.assertNotIn('default_server', config)
        self.assertEqual(config.count('proxy_set_header X-Forwarded-For $remote_addr;'), 2)
        self.assertEqual(config.count('location ^~ /.well-known/acme-challenge/'), 2)

    def test_dns_refuses_wrong_or_additional_address(self):
        def records(*addresses):
            return [(None, None, None, None, (address, 80)) for address in addresses]
        for addresses in [(domains.IP, '::1'), ('192.0.2.1',)]:
            with patch.object(domains.socket, 'getaddrinfo', return_value=records(*addresses)):
                with self.assertRaisesRegex(RuntimeError, 'debe resolver'):
                    domains.dns_ready()
        with patch.object(domains.socket, 'getaddrinfo', return_value=records(domains.IP)) as lookup:
            domains.dns_ready()
            self.assertEqual([call.args[0] for call in lookup.call_args_list], list(domains.NAMES))

    def test_changes_only_origin_preserving_private_configuration_bytes(self):
        old = f'APP_ORIGIN=https://{domains.LEGACY}'.encode()
        data = b'# note\r\nDATABASE_URL=fixture\r\n' + old + b'\r\nSMTP_PASSWORD="fixture"'
        self.assertEqual(domains.new_env(data), data.replace(old, f'APP_ORIGIN=https://{domains.FRONT}'.encode()))
        for invalid in (old + b'\n' + old, b'APP_ORIGIN=https://other.example', b''):
            with self.assertRaises(RuntimeError):
                domains.new_env(invalid)

    def test_renews_all_lineages_in_exclusive_directory(self):
        command = (f'ExecStart=/usr/bin/certbot renew --config-dir /opt/tomasini/acme/config '
                   f'--cert-name {domains.LEGACY} --deploy-hook /opt/tomasini/renew-certificate.sh\n')
        old = ('[Service]\nType=oneshot\n' + command + 'Nice=10\n').encode()
        updated = domains.new_renew(old).decode()
        self.assertIn(command.replace('--cert-name ' + domains.LEGACY + ' ', ''), updated)
        self.assertNotIn('--cert-name', updated)
        self.assertEqual(updated.count('ExecStart='), 1)
        with self.assertRaises(RuntimeError):
            domains.new_renew(b'[Service]\n')

    def test_rollback_refuses_unrecognized_content_before_any_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            files = {name: state / name for name in domains.FILES}
            old = {key: b'original' for key in files}
            new = {key: b'candidate' for key in files}
            for path in files.values():
                path.write_bytes(b'candidate')
            files['env'].write_bytes(b'external edit')
            with patch.object(domains, 'FILES', files), patch.object(domains, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'cambio ajeno'):
                    domains.restore(old, new, b'challenge', Mock(), {})
                run.assert_not_called()
            self.assertEqual(files['site'].read_bytes(), b'candidate')

    def test_rollback_after_acme_failure_only_reloads_nginx(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            files = {name: state / name for name in domains.FILES}
            old = {key: b'original' for key in files}
            new = {key: b'candidate' for key in files}
            for path in files.values():
                path.write_bytes(b'original')
            files['site'].write_bytes(b'challenge')
            core = Mock()
            core.status_http.return_value = 200
            with (patch.object(domains, 'FILES', files), patch.object(domains, 'STATE', state),
                  patch.object(domains, 'replace', side_effect=Path.write_bytes), patch.object(domains, 'run') as run):
                domains.restore(old, new, b'challenge', core, {})
            self.assertEqual(files['site'].read_bytes(), b'original')
            self.assertEqual([call.args for call in run.call_args_list], [('nginx', '-t'), ('systemctl', 'reload', 'nginx')])
            core.verify_existing.assert_called_once_with({})

    def test_rollback_after_activation_restores_environment_and_renewal(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            files = {name: state / name for name in domains.FILES}
            old = {key: b'original' for key in files}
            new = {key: b'candidate' for key in files}
            for path in files.values():
                path.write_bytes(b'candidate')
            marker = state / 'active.json'
            marker.write_text('{}')
            core = Mock()
            core.status_http.return_value = 200
            with (patch.object(domains, 'FILES', files), patch.object(domains, 'STATE', state),
                  patch.object(domains, 'replace', side_effect=Path.write_bytes), patch.object(domains, 'run') as run):
                domains.restore(old, new, b'challenge', core, {})
            self.assertFalse(marker.exists())
            self.assertEqual([path.read_bytes() for path in files.values()], list(old.values()))
            self.assertEqual([call.args for call in run.call_args_list],
                             [('systemctl', 'daemon-reload'), ('systemctl', 'restart', 'tomasini.service'),
                              ('nginx', '-t'), ('systemctl', 'reload', 'nginx')])


if __name__ == '__main__':
    unittest.main()
