/**
 * MongoDB Connection Management
 * 
 * This module manages connections to four logical databases on the same MongoDB Atlas cluster:
 * 
 * 1. **Content DB (lilo_content)**: Shared content database containing:
 *    - projects
 *    - problems (formerly questions)
 *    - modules
 *    - testcases
 *    This DB is used by all environments (production, staging, development).
 * 
 * 2. **App DB Production (lilo_app_prod)**: Production runtime database containing:
 *    - users
 *    - submissions
 *    - user_progress
 *    - feedback
 *    - telemetry
 *    - counters
 * 
 * 3. **App DB Staging (lilolp_staging)**: Staging runtime database with the same schema as prod,
 *    used for pre-production testing. Used when NODE_ENV === "staging".
 * 
 * 4. **App DB Development (lilo_app_dev)**: Development runtime database with the same schema as prod,
 *    but safe to wipe for testing. Used when NODE_ENV is not "production" or "staging".
 * 
 * **Database Selection Logic:**
 * - NODE_ENV === "production" → uses lilo_app_prod
 * - NODE_ENV === "staging" → uses lilolp_staging
 * - Otherwise (development/test) → uses lilo_app_dev
 * 
 * **When to use which database:**
 * - Use `getContentDb()` for: projects, problems, modules, testcases (content operations)
 * - Use `getAppDb()` for: users, submissions, user_progress, feedback, telemetry, counters (runtime operations)
 */

import { MongoClient, Collection, Db, Document, ReadPreferenceMode, WriteConcern } from "mongodb";
import { FeedbackDB, FeedbackDocument } from "../collections/feedback";
import { UserDocument, UsersDB } from "../collections/users";
import { UserProgressDB, UserProgressDocument } from "../collections/userProgress";
import { BugsDB, BugDocument } from "../collections/bugs";
import { FeaturesDB, FeatureDocument } from "../collections/features";
import { StudyPlansDB, StudyPlanDocument } from "../collections/studyPlans";
import { PlannerStateDB, PlannerStateDocument } from "../collections/plannerState";

// Validate required environment variables
if (!process.env.MONGO_URI && !process.env.MONGODB_URI) {
    throw new Error('Invalid/Missing environment variable: "MONGO_URI" or "MONGODB_URI" must be set');
}

if (!process.env.MONGO_DB_CONTENT) {
    throw new Error('Invalid/Missing environment variable: "MONGO_DB_CONTENT"');
}

// Only validate the app database that's needed for the current environment
type NodeEnv = "production" | "staging" | "development" | "test";
const nodeEnv = (process.env.NODE_ENV as NodeEnv) || "development";
if (nodeEnv === "production") {
    if (!process.env.MONGO_DB_APP) {
        throw new Error('Invalid/Missing environment variable: "MONGO_DB_APP"');
    }
} else if (nodeEnv === "staging") {
    if (!process.env.MONGO_DB_APP_STAGING) {
        throw new Error('Invalid/Missing environment variable: "MONGO_DB_APP_STAGING"');
    }
} else {
    if (!process.env.MONGO_DB_APP_DEV) {
        throw new Error('Invalid/Missing environment variable: "MONGO_DB_APP_DEV"');
    }
}

// Support both MONGO_URI and MONGODB_URI for backwards compatibility
const uri = process.env.MONGO_URI || process.env.MONGODB_URI!;
const options = {
    serverSelectionTimeoutMS: 60000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 45000,
    maxPoolSize: 1,
    retryWrites: true,
    retryReads: true,
    ssl: true,
    writeConcern: { w: 'majority' } as WriteConcern,
    readPreference: 'primaryPreferred' as ReadPreferenceMode,
    tlsAllowInvalidCertificates: false,
    heartbeatFrequencyMS: 10000,
};

let cachedClient: MongoClient | null = null;
let cachedContentDb: Db | null = null;
let cachedAppDb: Db | null = null;

export class Database {
    private static instance: Database;
    private client: MongoClient;
    private clientPromise: Promise<MongoClient>;
    public users!: UsersDB;
    public feedback!: FeedbackDB;
    public userProgress!: UserProgressDB;
    public bugs!: BugsDB;
    public features!: FeaturesDB;
    public studyPlans!: StudyPlansDB;
    public plannerState!: PlannerStateDB;
    public ready: Promise<void>;

    private constructor() {
        this.client = new MongoClient(uri, options);
        this.clientPromise = this.initializeConnection();
        this.ready = this.initializeCollections();
    }

    private async initializeConnection(): Promise<MongoClient> {
        try {
            console.log("Attempting to connect to MongoDB...");
            console.log("Connection URI:", uri.replace(/:[^:@]+@/, ':****@'));
            
            if (cachedClient) {
                console.log("Using cached MongoDB connection");
                return cachedClient;
            }

            const client = await this.client.connect();
            console.log("Successfully connected to MongoDB");
            
            // Ping both content and app databases to verify connection
            const contentDbName = process.env.MONGO_DB_CONTENT!;
            const appDbName = getAppDbName();
            await Promise.race([
                Promise.all([
                    client.db(contentDbName).command({ ping: 1 }),
                    client.db(appDbName).command({ ping: 1 })
                ]),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error("Ping timeout")), 45000)
                )
            ]);
            console.log(`Database ping successful (content: ${contentDbName}, app: ${appDbName})`);
            
            cachedClient = client;
            return client;
        } catch (error) {
            console.error("Error in MongoDB connection initialization:", error);
            cachedClient = null;
            throw error;
        }
    }
 
    private async initializeCollections(): Promise<void> {
        try {
            console.log("Initializing MongoDB collections...");
            const db = await this.getAppDb();

            cachedAppDb = db;

            console.log("Getting collection references...");
            
            try {
                const feedbackCollection: Collection<FeedbackDocument> = db.collection("feedback");
                this.feedback = new FeedbackDB(feedbackCollection);
                console.log("Feedback collection initialized");
            } catch (error) {
                console.error("Error initializing feedback collection:", error);
                // Continue with other collections even if one fails
            }
            
            try {
                const usersCollection: Collection<UserDocument> = db.collection("users");
                this.users = new UsersDB(usersCollection);
                console.log("Users collection initialized");
            } catch (error) {
                console.error("Error initializing users collection:", error);
                // Continue with other collections even if one fails
            }
            
            try {
                // Update the collection name to match the MongoDB collection
                console.log("Attempting to initialize UserProgress collection...");
                const userProgressCollection: Collection<UserProgressDocument> = db.collection("UserProgress");
                
                // Verify the collection exists by running a simple query
                await userProgressCollection.findOne({});
                
                this.userProgress = new UserProgressDB(userProgressCollection);
                console.log("User Progress collection initialized successfully");
            } catch (error) {
                console.error("Error initializing user progress collection:", error);
                console.error("This may indicate the UserProgress collection doesn't exist in the database");
                throw new Error(`Failed to initialize UserProgress collection: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            
            try {
                // Initialize bugs collection
                console.log("Attempting to initialize Bugs collection...");
                const bugsCollection: Collection<BugDocument> = db.collection("bugs");
                this.bugs = new BugsDB(bugsCollection);
                console.log("Bugs collection initialized successfully");
            } catch (error) {
                console.error("Error initializing bugs collection:", error);
                // Continue with other collections even if one fails
            }
            
            try {
                // Initialize features collection
                console.log("Attempting to initialize Features collection...");
                const featuresCollection: Collection<FeatureDocument> = db.collection("features");
                this.features = new FeaturesDB(featuresCollection);
                console.log("Features collection initialized successfully");
            } catch (error) {
                console.error("Error initializing features collection:", error);
                // Continue with other collections even if one fails
            }
            
            try {
                // Initialize study plans collection
                console.log("Attempting to initialize StudyPlans collection...");
                const studyPlansCollection: Collection<StudyPlanDocument> = db.collection("study_plans");
                this.studyPlans = new StudyPlansDB(studyPlansCollection);
                console.log("StudyPlans collection initialized successfully");
            } catch (error) {
                console.error("Error initializing study plans collection:", error);
                // Continue with other collections even if one fails
            }
            
            try {
                // Initialize planner state collection
                console.log("Attempting to initialize PlannerState collection...");
                const plannerStateCollection: Collection<PlannerStateDocument> = db.collection("planner_state");
                this.plannerState = new PlannerStateDB(plannerStateCollection);
                console.log("PlannerState collection initialized successfully");
            } catch (error) {
                console.error("Error initializing planner state collection:", error);
                // Continue with other collections even if one fails
            }
        } catch (error) {
            console.error("Error initializing collections:", error);
            throw error;
        }
    }

    public static async getInstance(): Promise<Database> {
        if (!Database.instance) {
            console.log("Creating new Database instance...");
            Database.instance = new Database();
            try {
                await Database.instance.ready;
                console.log("Database instance successfully initialized");
            } catch (error) {
                console.error("Failed to initialize Database instance:", error);
                Database.instance = null as any;
                throw error;
            }
        }
        return Database.instance;
    }

    public getClient(): Promise<MongoClient> {
        return this.clientPromise;
    }

    private async getAppDb(): Promise<Db> {
        try {
            if (cachedAppDb) {
                return cachedAppDb;
            }

            const client = await this.getClient();
            const dbName = getAppDbName();
            const db = client.db(dbName);
            cachedAppDb = db;
            return db;
        } catch (error) {
            console.error("Error getting app database:", error);
            throw error;
        }
    }

    public async getCollection<T extends Document>(name: string): Promise<Collection<T>> {
        try {
            const db = await this.getAppDb();
            return db.collection<T>(name);
        } catch (error) {
            console.error(`Error getting collection ${name}:`, error);
            throw error;
        }
    }

    /**
     * Get a collection from a specific environment (prod, staging, or dev)
     * Useful for admin tools that need to query a specific database
     */
    public async getCollectionForEnv<T extends Document>(name: string, env: "prod" | "staging" | "dev"): Promise<Collection<T>> {
        try {
            const client = await this.getClient();
            let dbName: string;
            switch (env) {
                case "prod":
                    dbName = process.env.MONGO_DB_APP!;
                    break;
                case "staging":
                    dbName = process.env.MONGO_DB_APP_STAGING!;
                    break;
                default:
                    dbName = process.env.MONGO_DB_APP_DEV!;
            }
            return client.db(dbName).collection<T>(name);
        } catch (error) {
            console.error(`Error getting collection ${name} from ${env}:`, error);
            throw error;
        }
    }

    public async testConnection(): Promise<boolean> {
        try {
            const client = await this.getClient();
            const contentDbName = process.env.MONGO_DB_CONTENT!;
            const appDbName = getAppDbName();
            await Promise.all([
                client.db(contentDbName).command({ ping: 1 }),
                client.db(appDbName).command({ ping: 1 })
            ]);
            console.log("MongoDB connection test successful");
            return true;
        } catch (error) {
            console.error("MongoDB connection test failed:", error);
            throw error;
        }
    }
}

/**
 * Helper function to determine which app database to use based on NODE_ENV
 * @returns The app database name (lilo_app_prod, lilolp_staging, or lilo_app_dev)
 */
function getAppDbName(): string {
    const env = process.env.NODE_ENV as string;
    if (env === "production") {
        return process.env.MONGO_DB_APP!;
    } else if (env === "staging") {
        return process.env.MONGO_DB_APP_STAGING!;
    } else {
        return process.env.MONGO_DB_APP_DEV!;
    }
}

/**
 * Get the content database instance.
 * This database contains shared content (projects, problems, modules, testcases)
 * that is used by both production and development environments.
 * 
 * @returns The content database (Db) instance
 */
export function getContentDb(): Db {
    if (!cachedClient) {
        throw new Error("MongoDB client not initialized. Call connectToDatabase() first or use Database.getInstance()");
    }
    
    if (cachedContentDb) {
        return cachedContentDb;
    }
    
    const dbName = process.env.MONGO_DB_CONTENT!;
    cachedContentDb = cachedClient.db(dbName);
    return cachedContentDb;
}

/**
 * Get the app database instance.
 * This database contains runtime data (users, submissions, feedback, telemetry, etc.)
 * The specific database is determined by NODE_ENV:
 * - NODE_ENV === "production" → returns lilo_app_prod
 * - NODE_ENV === "staging" → returns lilolp_staging
 * - Otherwise → returns lilo_app_dev
 * 
 * @returns The app database (Db) instance
 */
export function getAppDb(): Db {
    if (!cachedClient) {
        throw new Error("MongoDB client not initialized. Call connectToDatabase() first or use Database.getInstance()");
    }
    
    if (cachedAppDb) {
        return cachedAppDb;
    }
    
    const dbName = getAppDbName();
    cachedAppDb = cachedClient.db(dbName);
    return cachedAppDb;
}

/**
 * Connect to the database and return the client and app database.
 * This function maintains backwards compatibility by returning the app database.
 * For content operations, use getContentDb() instead.
 * 
 * @returns Object containing the MongoDB client and app database instance
 */
export async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
    if (cachedClient && cachedAppDb) {
        console.log("Using cached database connection");
        return { client: cachedClient, db: cachedAppDb };
    }

    if (!cachedClient) {
        console.log("Creating new database connection");
        cachedClient = await new MongoClient(uri, options).connect();
    }

    const db = getAppDb();

    return { client: cachedClient, db };
}

const db = Database.getInstance();

export default db;
