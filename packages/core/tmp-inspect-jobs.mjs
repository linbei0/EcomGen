import Database from "better-sqlite3";
const db = new Database("e:/project/EcomGen/data/ecomgen.sqlite", { readonly: true });
for (const p of db.prepare("SELECT id, name, models_json FROM providers").all()) {
  console.log(`\n=== provider ${p.name} ===`);
  const models = JSON.parse(p.models_json ?? "[]");
  for (const m of models) console.log(JSON.stringify(m).slice(0, 400));
}
