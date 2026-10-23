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

test("consequential private routes reject missing and malformed sessions before handlers run", async () => {
  await withServer(app,async baseUrl => {
    const expiredShapedToken = [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ sub: "synthetic-expired-session", iat: 0, exp: 1 })).toString("base64url"),
      "synthetic-invalid-signature",
    ].join(".");
    const requests: Array<{path:string;init?:RequestInit}> = [
      { path: "/api/deals/command-center" },
      { path: "/api/leads/00000000-0000-4000-8000-000000000001" },
      { path: "/api/leads/00000000-0000-4000-8000-000000000001/evidence-packet" },
      { path: "/api/leads/00000000-0000-4000-8000-000000000001/contact-paths" },
      { path: "/api/deals/00000000-0000-4000-8000-000000000001/operations" },
      {
        path: "/api/leads/00000000-0000-4000-8000-000000000001/calls",
        init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      },
      {
        path: "/api/leads/00000000-0000-4000-8000-000000000001/offers/00000000-0000-4000-8000-000000000002/authorize",
        init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      },
      { path: "/api/operations/transaction-readiness" },
      { path: "/api/buyers" },
      { path: "/api/buyers/00000000-0000-4000-8000-000000000001/contact-research" },
      {
        path: `/api/property-discoveries/${"00000000-0000-4000-8000-000000000001"}/contact-research`,
        init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      },
      {
        path: "/api/buyers/00000000-0000-4000-8000-000000000001/contact-permission",
        init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      },
      { path: "/api/deals/00000000-0000-4000-8000-000000000001/distribution" },
      {
        path: "/api/deals/00000000-0000-4000-8000-000000000001/distribution/authorize",
        init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      },
      {
        path: "/api/deals/00000000-0000-4000-8000-000000000001/contract/documents/00000000-0000-4000-8000-000000000002/file",
      },
      {
        path: "/api/deals/00000000-0000-4000-8000-000000000001/contract/milestones",
        init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      },
      { path: "/api/workspace-setup" },
      { path: "/api/deals/audit" },
    ];
    for (const session of ["missing","malformed","expired-shaped"] as const) {
      for (const {path,init} of requests) {
        const headers = new Headers(init?.headers);
        if (session==="malformed") headers.set("Authorization","Bearer invalid.session.token");
        if (session==="expired-shaped") headers.set("Authorization",`Bearer ${expiredShapedToken}`);
        const response = await fetch(`${baseUrl}${path}`,{...init,headers});
        assert.equal(response.status,401,`${session} session ${path}`);
        const body = await response.json() as { error?: string };
        assert.match(body.error ?? "",/sign in|authenticated|session/i,`${session} session ${path}`);
        assert.doesNotMatch(JSON.stringify(body),/synthetic-expired-session|synthetic-invalid-signature|invalid\.session\.token/,
          "Authentication failures must not echo bearer credentials.");
      }
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

