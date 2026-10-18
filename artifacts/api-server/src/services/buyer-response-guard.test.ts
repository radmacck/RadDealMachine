import test from "node:test";
import assert from "node:assert/strict";
import type { Buyer } from "@workspace/deal-domain";
import { assertBuyerResponseIdentityClear } from "./buyer-response-guard";

const buyer = {id:"buyer-1",email:"buyer@example.test",phone:"5551000"} as Buyer;
const duplicate = {id:"buyer-2",email:" BUYER@example.test ",phone:"5552000"} as Buyer;

test("buyer interest and commitment reject duplicate identities; an explicit decline may still be recorded",()=>{
  for (const status of ["INTERESTED","COMMITTED"] as const) {
    assert.throws(
      ()=>assertBuyerResponseIdentityClear(buyer,[buyer,duplicate],status),
      (error)=> (error as {status?:number}).status===409 && /resolve identity/.test((error as Error).message),
    );
  }
  assert.doesNotThrow(()=>assertBuyerResponseIdentityClear(buyer,[buyer,duplicate],"DECLINED"));
});
