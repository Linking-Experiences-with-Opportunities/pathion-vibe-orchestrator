export interface MongoDBConfigProps {
    collections?: {
        Accounts?: string
        Sessions?: string
        Users?: string
        VerificationTokens?: string
    }
    databaseName?: string
}

/**
 * MongoDB connection URI
 * Supports both MONGO_URI and MONGODB_URI for backwards compatibility
 */
export const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || "";

/**
 * Shared content DB (problems, projects, modules)
 * Used by both production and development environments
 */
export const CONTENT_DB_NAME = process.env.MONGO_DB_CONTENT || "";

/**
 * Production runtime DB
 * Contains users, submissions, feedback, telemetry, etc.
 */
export const APP_DB_NAME = process.env.MONGO_DB_APP || "";

/**
 * Development runtime DB (safe to wipe, same schema as prod)
 * Used when NODE_ENV !== "production" and NODE_ENV !== "staging"
 */
export const APP_DB_DEV_NAME = process.env.MONGO_DB_APP_DEV || "";

/**
 * Staging runtime DB
 * Used when NODE_ENV === "staging"
 */
export const APP_DB_STAGING_NAME = process.env.MONGO_DB_APP_STAGING || "";

export const MongoDBEnvConfig: { test: MongoDBConfigProps; staging: MongoDBConfigProps; prod: MongoDBConfigProps } = {
    test: {
        collections: {
            Accounts: "accounts",
            Sessions: "sessions",
            Users: "users",
            VerificationTokens: "verificationTokens",
        },
        databaseName: APP_DB_DEV_NAME,
    },
    staging: {
        collections: {
            Accounts: "accounts",
            Sessions: "sessions",
            Users: "users",
            VerificationTokens: "verificationTokens",
        },
        databaseName: APP_DB_STAGING_NAME,
    },
    prod: {
        collections: {
            Accounts: "accounts",
            Sessions: "sessions",
            Users: "users",
            VerificationTokens: "verificationTokens",
        },
        databaseName: APP_DB_NAME,
    },
};