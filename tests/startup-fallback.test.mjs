import { test } from "node:test";
import assert from "node:assert/strict";
import { patchStartup } from "../scripts/patch-startup-fallback.mjs";

test("failed optional bootstrap initializes a local client; success and non-web errors retain behavior", async () => {
  const source = `async function init(e) {
    let t = await cUo(e);
    return (e.dataAdapter.setData(t.statsigPayload), t.user);
  }; return init;`;
  const patched = patchStartup(source);
  assert.equal(patchStartup(patched), patched);
  const make = (mode, bootstrap) => new Function("window", "cUo", patched)(
    {__ELECTRON_SHIM__:{codexOnlyMode:mode}}, bootstrap);
  const params = {stableId:"test-device", dataAdapter:{setData(){throw Error("must preserve cache on failure");}}};
  const fail = async () => {throw Error("bootstrap unavailable");};
  assert.equal((await make(true,fail)(params)).userID, "test-device");
  await assert.rejects(make(false,fail)(params), /bootstrap unavailable/);
  let seeded;
  const result = await make(true, async()=>({user:{userID:"real-user"},statsigPayload:"real-flags"}))({dataAdapter:{setData(value){seeded=value;}}});
  assert.equal(result.userID,"real-user");
  assert.equal(seeded,"real-flags");
  assert.throws(()=>patchStartup("upstream changed"), /no longer matches/);
});
