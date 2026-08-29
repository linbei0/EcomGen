import { Type, type SchemaOptions, type Static, type TSchema } from "@sinclair/typebox";

/**
 * Creates a JSON Schema reference while preserving the referenced schema's
 * TypeScript static type. TypeBox 0.34 deprecates the schema-object overload
 * of Type.Ref, so all contract references go through this helper.
 */
export function schemaRef<T extends TSchema>(schema: T, options?: SchemaOptions) {
  if (!schema.$id) throw new Error("Referenced TypeBox schemas must define $id");
  return Type.Unsafe<Static<T>>(Type.Ref(schema.$id, options));
}
