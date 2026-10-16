import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool, settingsTable, auditTable } from "@workspace/db";
import { emptyWorkspaceSetup, getWorkspaceSetupStatus, loadWorkspaceSetup, saveWorkspaceSetup } from "./workspace-setup";

const actor = `synthetic-workspace-setup:${randomUUID()}`;
try {
  assert.deepEqual(await loadWorkspaceSetup(), emptyWorkspaceSetup);
  await assert.rejects(saveWorkspaceSetup(emptyWorkspaceSetup, actor, "ANALYST"), (error) => (error as { status: number }).status === 403);
  const saved = {
    ...emptyWorkspaceSetup,
    contactResearchMethod: "MANUAL" as const,
    states: ["PA"],
    counties: ["Philadelphia"],
    zipCodes: ["19103"],
    notifications: { ...emptyWorkspaceSetup.notifications, providerFailures: false },
  };
  await saveWorkspaceSetup(saved, actor, "OWNER");
  assert.deepEqual(await loadWorkspaceSetup(), saved, "owner preferences persist and reload");
  const status = await getWorkspaceSetupStatus();
  assert.equal(status.settings.find(item => item.id === "contact-research")?.status, "CONFIGURED");
  assert.equal(status.settings.find(item => item.id === "email")?.status, "MISSING",
    "No email provider or credential/health evidence must stay explicitly missing.");
  await db.update(settingsTable).set({ assumptions: { workspaceSetup: { ...saved, zipCodes: ["bad"] } } })
    .where(eq(settingsTable.id, 3));
  const invalid = await getWorkspaceSetupStatus();
  assert.equal(invalid.persistenceStatus, "INVALID", "Invalid persisted settings must not silently become configured defaults.");
  assert.equal(invalid.settings.find(item => item.id === "notifications")?.status, "INVALID");
  await saveWorkspaceSetup(saved, actor, "OWNER");
  assert.ok(!JSON.stringify(status).includes("apiKey"));
  console.log(JSON.stringify({
    persisted: true,
    ownerAuthorizationEnforced: true,
    invalidSavedSettingsVisible: invalid.persistenceStatus === "INVALID",
    manualContactSetup: status.settings.find(item => item.id === "contact-research")?.status,
    emailConnection: status.settings.find(item => item.id === "email")?.status,
    sourceStatuses: [...new Set(status.sources.map(source => source.status))],
    synthetic: true,
  }, null, 2));
} finally {
  await db.delete(settingsTable).where(eq(settingsTable.id, 3));
  await db.delete(auditTable).where(eq(auditTable.actor, actor));
  await pool.end();
}
