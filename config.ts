const { env } = process

function uInt(x: any, defaultValue = 0) {
    x = parseInt(x + "", 10);
    if (isNaN(x) || !isFinite(x) || x < 0) {
        x = uInt(defaultValue, 0);
    }
    return x;
}


export default {

    /**
     * The port to listen on. If not set defaults to system-allocated port
     */
    port: env.PORT || 0,

    /**
     * The host to listen on. If not set defaults to "localhost"
     */
    host: env.HOST || "0.0.0.0",

    /**
     * We use this to sign our tokens
     */
    jwtSecret: env.SECRET || "this is a secret",

    /**
     * Default access token lifetime in minutes
     */
    accessTokenLifetime: env.ACCESS_TOKEN_LIFETIME || 60,

    /**
     * Default refresh token lifetime in minutes
     */
    refreshTokenLifeTime: env.REFRESH_TOKEN_LIFETIME || 60 * 24 * 365,
    
    /**
     * Accept JWKs using the following algorithms
     */
    supportedAlgorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],

    // Keep un-approved jobs for how long (minutes since creation)?
    jobMaxLifetimeMinutes: uInt(env.JOB_MAX_LIFETIME_MINUTES, 5),

    // Keep completed jobs for how long (minutes since completion)?
    completedJobLifetimeMinutes: uInt(env.COMPLETED_JOB_LIFETIME_MINUTES, 5),

    // // Check for old jobs once every ? minutes
    jobCleanupMinutes: uInt(env.JOB_CLEANUP_MINUTES, 1),

    // // MS to wait after appending each resource to its ndjson file
    jobThrottle: uInt(env.JOB_THROTTLE, 0)
}
