import betterAuth from "@convex-dev/better-auth/convex.config";
import lumail from "@lumail/convex/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(betterAuth);
app.use(lumail);

export default app;
