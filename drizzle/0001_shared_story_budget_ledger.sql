CREATE TABLE "story_budget_usage" (
	"projectId" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"settledTokens" integer DEFAULT 0 NOT NULL,
	"settledCostMicroUsd" integer DEFAULT 0 NOT NULL,
	"reservedTokens" integer DEFAULT 0 NOT NULL,
	"reservedCostMicroUsd" integer DEFAULT 0 NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_budget_usage_nonnegative" CHECK ("settledTokens" >= 0 AND "settledCostMicroUsd" >= 0 AND "reservedTokens" >= 0 AND "reservedCostMicroUsd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "story_budget_reservations" (
	"projectId" text NOT NULL,
	"operationId" text NOT NULL,
	"requestFingerprint" text NOT NULL,
	"role" text NOT NULL,
	"inputTokenBound" integer NOT NULL,
	"outputTokenBound" integer NOT NULL,
	"inputMicroUsdPerMillion" integer NOT NULL,
	"outputMicroUsdPerMillion" integer NOT NULL,
	"reservedTokens" integer NOT NULL,
	"reservedCostMicroUsd" integer NOT NULL,
	"actualInputTokens" integer,
	"actualOutputTokens" integer,
	"actualCostMicroUsd" integer,
	"status" text DEFAULT 'dispatched' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "story_budget_reservation_status" CHECK ("status" IN ('dispatched', 'uncertain', 'settled', 'blocked')),
	CONSTRAINT "story_budget_reservation_nonnegative" CHECK ("inputTokenBound" >= 0 AND "outputTokenBound" >= 0 AND "reservedTokens" > 0 AND "reservedCostMicroUsd" >= 0),
	CONSTRAINT "story_budget_reservation_positive_rates" CHECK ("inputMicroUsdPerMillion" > 0 AND "outputMicroUsdPerMillion" > 0),
	CONSTRAINT "story_budget_reservation_actual_nonnegative" CHECK (("actualInputTokens" IS NULL OR "actualInputTokens" >= 0) AND ("actualOutputTokens" IS NULL OR "actualOutputTokens" >= 0) AND ("actualCostMicroUsd" IS NULL OR "actualCostMicroUsd" >= 0))
);
--> statement-breakpoint
ALTER TABLE "story_budget_usage" ADD CONSTRAINT "story_budget_usage_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_budget_usage" ADD CONSTRAINT "story_budget_usage_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_budget_reservations" ADD CONSTRAINT "story_budget_reservations_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Existing projects have unknown historical model spend; block them rather than assuming a fresh budget.
INSERT INTO "story_budget_usage" ("projectId", "ownerId", "blocked")
SELECT "id", "ownerId", true FROM "projects"
ON CONFLICT ("projectId") DO NOTHING;--> statement-breakpoint
CREATE UNIQUE INDEX "story_budget_reservation_operation" ON "story_budget_reservations" USING btree ("projectId","operationId");--> statement-breakpoint
CREATE INDEX "story_budget_reservation_project_status" ON "story_budget_reservations" USING btree ("projectId","status");
