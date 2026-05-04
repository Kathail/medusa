import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260504084004 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "cj_variant" drop constraint if exists "cj_variant_cj_vid_unique";`);
    this.addSql(`create table if not exists "cj_variant" ("id" text not null, "cj_vid" text not null, "cj_pid" text not null, "warehouse_code" text not null, "cost_price" integer not null, "last_synced_stock" integer null, "last_synced_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cj_variant_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cj_variant_cj_vid_unique" ON "cj_variant" ("cj_vid") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cj_variant_deleted_at" ON "cj_variant" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "cj_variant" cascade;`);
  }

}
