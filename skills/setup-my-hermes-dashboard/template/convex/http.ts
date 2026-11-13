import { httpRouter } from "convex/server";

import { authComponent, createAuth } from "./auth";

/** Better Auth's endpoints. The dashboard proxies /api/auth/* here, so its cookies stay on the dashboard's domain. */
const http = httpRouter();
authComponent.registerRoutes(http, createAuth);

export default http;
