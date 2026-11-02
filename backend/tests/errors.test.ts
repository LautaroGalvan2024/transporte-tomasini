import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { errorHandler } from "../src/errors.js";

test("los conflictos de SQL crudo agotados responden 409 sin filtrar detalles internos", async () => {
  for (const originalCode of ["40001", "40P01"]) {
    const app = express();
    app.get("/", () => {
      throw new Prisma.PrismaClientKnownRequestError("private SQL details", {
        code: "P2010",
        clientVersion: Prisma.prismaVersion.client,
        meta: {
          driverAdapterError: new Error("private driver details", {
            cause: { originalCode },
          }),
        },
      });
    });
    app.use(errorHandler);
    const result = await request(app).get("/");
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "CONFLICT");
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /private|P2010|40001|40P01/,
    );
  }
});
