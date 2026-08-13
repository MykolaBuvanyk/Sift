import "express";

declare module "express" {
  interface Request {
    id?: string;
    user?: {
      id: string;
      authMethod: "static_bearer";
    };
  }
}
