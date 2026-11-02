import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('ci_sandbox_smoke', Path(__file__).with_name('ci_sandbox_smoke.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class SandboxSmokeGuardTests(unittest.TestCase):
    def test_only_identified_github_hosted_linux_runs_are_accepted(self):
        environment = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux',
                       'GITHUB_REPOSITORY': smoke.REPOSITORY, 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1',
                       'GITHUB_WORKSPACE': '/runner/work/project', 'RUNNER_TOOL_CACHE': '/runner/tools'}
        smoke.guard_runner_environment(environment)
        for name in environment:
            with self.subTest(missing=name), self.assertRaises(RuntimeError):
                smoke.guard_runner_environment({key: value for key, value in environment.items() if key != name})
        for name, value in [('RUNNER_ENVIRONMENT', 'self-hosted'), ('RUNNER_OS', 'Windows'), ('GITHUB_ACTIONS', 'false'),
                            ('GITHUB_REPOSITORY', 'another/repository'), ('GITHUB_RUN_ID', '../production')]:
            with self.subTest(name=name, value=value), self.assertRaises(RuntimeError):
                smoke.guard_runner_environment({**environment, name: value})


if __name__ == '__main__':
    unittest.main()
