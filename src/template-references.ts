export type TemplateReferenceMigration = { epoch: number; ids: Record<string,string> };

export const templateReferenceEpoch = (migrations:TemplateReferenceMigration[]) => migrations[migrations.length-1]?.epoch ?? 0;

export function appendTemplateReferenceMigration(migrations:TemplateReferenceMigration[],ids:Record<string,string>) {
  return Object.keys(ids).length ? [...migrations,{epoch:templateReferenceEpoch(migrations)+1,ids:{...ids}}] : migrations;
}

export function validTemplateReferenceMigrations(value:unknown):value is TemplateReferenceMigration[] {
  if(!Array.isArray(value) || value.length>1000)return false;
  let previous=0;
  const id=(value:unknown)=>typeof value==="string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !["__proto__","constructor","prototype"].includes(value);
  return value.every(migration=>{
    if(!migration || !Number.isSafeInteger(migration.epoch) || migration.epoch<=previous || !migration.ids || typeof migration.ids!=="object" || Array.isArray(migration.ids) || Object.keys(migration.ids).length>1000)return false;
    previous=migration.epoch;
    return Object.entries(migration.ids).every(([from,to])=>id(from)&&id(to)&&from!==to);
  });
}

// Old session references move forward; choices saved after that migration keep
// their current meaning even when an official template reuses the old ID.
export function remapTemplateReference(id:string,migrations:TemplateReferenceMigration[],savedEpoch=0) {
  for(const migration of migrations) {
    if(migration.epoch<=savedEpoch)continue;
    const seen=new Set<string>();
    while(migration.ids[id] && !seen.has(id)){seen.add(id);id=migration.ids[id];}
  }
  return id;
}
