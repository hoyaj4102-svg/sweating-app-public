import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { supabaseProjectRef } from "../lib/supabase-project-ref";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    supabase_project_ref: supabaseProjectRef(process.env.SUPABASE_URL),
  });
  res.json(data);
});

export default router;
