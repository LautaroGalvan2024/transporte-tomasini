import { useState, useSyncExternalStore } from "react";
import { Modal } from "./ui";
import {
  canPromptInstall,
  requestInstallShortcut,
  subscribeToInstall,
  type InstallResult,
} from "./install-shortcut";

export { registerInstallShortcut } from "./install-shortcut";

function manualSteps(): string[] {
  const agent = navigator.userAgent;
  const iPad =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (iPad || /iPhone|iPad|iPod/i.test(agent)) {
    return [
      "Tocá Compartir. Si estás en otra aplicación y no ves esa opción, abrí Tomasini en Safari.",
      "Elegí Agregar a inicio. Si aparece Abrir como app web, activalo.",
      "Tocá Agregar para guardar el ícono.",
    ];
  }
  if (/Android/i.test(agent)) {
    if (/Firefox\//i.test(agent)) {
      return [
        "Abrí el menú de Firefox y tocá Instalar.",
        "Confirmá dónde querés agregar el ícono en la pantalla de inicio.",
      ];
    }
    return [
      "Abrí el menú del navegador y buscá Instalar o Agregar a la pantalla de inicio. En Chrome puede aparecer dentro de Instalar y crear acceso directo.",
      "Confirmá para agregar el ícono de Tomasini.",
    ];
  }
  if (/Firefox\//i.test(agent)) {
    if (/Windows/i.test(agent)) {
      return [
        "Hacé clic en el ícono de aplicaciones web de la barra de direcciones de Firefox.",
        "Si esa opción no aparece, arrastrá el candado de la barra de direcciones al escritorio para crear el acceso.",
      ];
    }
    return [
      "Ajustá la ventana de Firefox para ver el escritorio.",
      "Arrastrá el candado de la barra de direcciones al escritorio.",
    ];
  }
  if (/Edg\//i.test(agent)) {
    return [
      "Abrí el menú de Edge y buscá Aplicaciones.",
      "Elegí instalar Tomasini como aplicación y confirmá.",
    ];
  }
  if (/Chrome\/|Chromium\//i.test(agent)) {
    return [
      "Abrí el menú de Chrome y buscá la sección de guardar y compartir.",
      "Elegí Instalar página como aplicación o Crear acceso directo y confirmá.",
    ];
  }
  if (/Macintosh/i.test(agent) && /Safari\//i.test(agent)) {
    return [
      "En Safari, abrí Archivo y elegí Agregar al Dock.",
      "Confirmá el nombre Tomasini y hacé clic en Agregar. Si tu versión de Safari no ofrece esa opción, podés guardar un marcador.",
    ];
  }
  return [
    "Abrí el menú de tu navegador y buscá Instalar aplicación, Agregar a inicio o Crear acceso directo.",
    "Si tu navegador no ofrece esas opciones, guardá Tomasini en tus marcadores.",
  ];
}

function ShortcutDialog({
  result,
  retry,
  busy,
  close,
}: {
  result: InstallResult;
  retry: () => void;
  busy: boolean;
  close: () => void;
}) {
  const canRetry = useSyncExternalStore(subscribeToInstall, canPromptInstall);
  const installed = result === "already-installed" || result === "installed";
  const showHelp = !installed && result !== "accepted";
  const needsHome =
    location.pathname !== "/" || Boolean(location.search || location.hash);
  let title = "Crear acceso directo";
  if (installed)
    title =
      result === "already-installed"
        ? "Tomasini ya está instalado"
        : "Tomasini está instalado";
  if (result === "accepted") title = "Instalación aceptada";
  return (
    <Modal title={title} onClose={close}>
      <div className="modal-body shortcut-instructions">
        {installed && <p>Podés abrir Tomasini desde tus aplicaciones.</p>}
        {result === "accepted" && (
          <p>El navegador está agregando Tomasini a tus aplicaciones.</p>
        )}
        {showHelp && (
          <>
            {result === "dismissed" && (
              <p>
                La instalación no se completó. También podés crear el acceso
                desde tu navegador.
              </p>
            )}
            {result === "failed" && (
              <p>
                El navegador no pudo iniciar la instalación. Podés crear el
                acceso siguiendo estos pasos.
              </p>
            )}
            <ol>
              {needsHome && (
                <li>
                  Seleccioná{" "}
                  <a href="/" target="_blank" rel="noopener noreferrer">
                    Abrir inicio
                  </a>{" "}
                  y continuá en la pestaña nueva.
                </li>
              )}
              {manualSteps().map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </>
        )}
        <div className="row-actions">
          {showHelp && canRetry && (
            <button
              type="button"
              className="button secondary"
              onClick={retry}
              disabled={busy}
            >
              {busy ? "Esperando al navegador…" : "Volver a intentar"}
            </button>
          )}
          <button type="button" className="button primary" onClick={close}>
            Entendido
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Share open/busy across menu buttons and mount dialog once in the application shell. */
export function useInstallShortcut() {
  const [result, setResult] = useState<InstallResult | null>(null);
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    try {
      setResult(await requestInstallShortcut());
    } finally {
      setBusy(false);
    }
  }
  return {
    open,
    busy,
    dialog: result && (
      <ShortcutDialog
        result={result}
        retry={open}
        busy={busy}
        close={() => setResult(null)}
      />
    ),
  };
}
