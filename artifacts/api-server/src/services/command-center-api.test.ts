import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import pinoHttp from "pino-http";
import { test } from "node:test";
import { AddressInfo } from "node:net";
import app, { apiErrorHandler } from "../app";
import { logger } from "../lib/logger";

async function withServer<T>(serverApp: express.Express, callback: (baseUrl: string) => Promise<T>) {
  const server = serverApp.listen(0, "127.0.0.1");
  await once(server,"listening");
  const address = server.address() as AddressInfo;
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("actual private command-center, transaction, contact-research, and buyer-permission routes require a session", async () => {
  await withServer(app,async baseUrl => {
    const requests: Array<{path:string;init?:RequestInit}> = [
      { path: "/api/deals/command-center" },
      { path: "/api/operations/transaction-readiness" },
      {
        path: `/api/property-discoveries/${"00000000-0000-4000-8000-000000000001"}/contact-research`,
        init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      },
      {
        path: "/api/buyers/00000000-0000-4000-8000-000000000001/contact-permission",
        init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      },
    ];
    for (const {path,init} of requests) {
      const response = await fetch(`${baseUrl}${path}`,init);
      assert.equal(response.status,401,path);
      const body = await response.json() as { error?: string };
      assert.match(body.error ?? "",/sign in|authenticated|session/i,path);
    }
  });
});

test("the shared API error handler returns an explicit 500 without exposing internal error details", async () => {
  const testApp = express();
  testApp.use(pinoHttp({ logger }));
  testApp.get("/synthetic-failure",(_request,_response,next) => next(new Error("synthetic internal test marker")));
  testApp.use(apiErrorHandler);
  await withServer(testApp,async baseUrl => {
    const response = await fetch(`${baseUrl}/synthetic-failure`);
    assert.equal(response.status,500);
    const body = await response.json() as { error?: string };
    assert.equal(body.error,"An unexpected server error occurred. No successful save was confirmed.");
    assert.doesNotMatch(JSON.stringify(body),/synthetic internal test marker/);
  });
});

