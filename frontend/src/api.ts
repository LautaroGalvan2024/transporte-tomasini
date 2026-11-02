export class ApiError extends Error {
  fields: Record<string, string>;
  code: string;
  status: number;
  constructor(
    message: string,
    status: number,
    fields: Record<string, string> = {},
    code = "",
  ) {
    super(message);
    this.fields = fields;
    this.code = code;
    this.status = status;
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Tomasini-Request": "1",
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(
      "No pudimos conectar. Revisá tu conexión e intentá de nuevo.",
      0,
    );
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (
    response.status === 401 &&
    !["/auth/login", "/auth/logout", "/auth/me"].includes(path)
  )
    window.dispatchEvent(new Event("tomasini:session-expired"));
  if (!response.ok)
    throw new ApiError(
      body?.error?.message ||
        "No pudimos completar la acción. Intentá nuevamente.",
      response.status,
      body?.error?.fields,
      body?.error?.code,
    );
  return body as T;
}
export function send<T>(path: string, method: string, body?: unknown) {
  return api<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
