import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { isRetryableTransactionError } from "./db.js";

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "INVALID_REQUEST",
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}
export function ensure(
  condition: unknown,
  status: number,
  message: string,
  code?: string,
): asserts condition {
  if (!condition) throw new AppError(status, message, code);
}
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  _req,
  res,
  _next,
) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        message: err.message,
        code: err.code,
        ...(err.fields ? { fields: err.fields } : {}),
      },
    });
    return;
  }
  if (err instanceof ZodError) {
    const fields = Object.fromEntries(
      err.issues.map((i) => [i.path.join("."), i.message]),
    );
    res.status(400).json({
      error: {
        message: "Revisá los campos indicados.",
        code: "VALIDATION",
        fields,
      },
    });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({
        error: {
          message: "Ya existe un registro con esos datos.",
          code: "DUPLICATE",
        },
      });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({
        error: { message: "No se encontró el registro.", code: "NOT_FOUND" },
      });
      return;
    }
    if (isRetryableTransactionError(err)) {
      res.status(409).json({
        error: {
          message: "Otro usuario modificó estos datos. Volvé a intentar.",
          code: "CONFLICT",
        },
      });
      return;
    }
    if (err.code === "P2003") {
      res.status(400).json({
        error: {
          message: "La referencia indicada no existe.",
          code: "INVALID_REFERENCE",
        },
      });
      return;
    }
  }
  if (
    err &&
    typeof err === "object" &&
    "type" in err &&
    ["entity.too.large", "entity.parse.failed"].includes(String(err.type))
  ) {
    res.status(400).json({
      error: {
        message: "Solicitud inválida o demasiado grande.",
        code: "INVALID_BODY",
      },
    });
    return;
  }
  console.error(
    "Error interno en API Tomasini:",
    err instanceof Prisma.PrismaClientKnownRequestError
      ? err.code
      : err instanceof Error
        ? err.name
        : "Error",
  );
  res.status(500).json({
    error: {
      message: "No pudimos completar la operación. Intentá nuevamente.",
      code: "INTERNAL",
    },
  });
};
