module.exports = {
    
    // Specify "require" for CommonJS
    // require: "ts-node/register",

    // Specify "loader" for native ESM
    // loader: "ts-node/esm",

    extensions: ["ts"],

    "watch-files": [
        ".",
        "test"
    ],

    spec: [
        "./test/unit/**/*.test.ts",
        "./test/integration/**/*.test.ts"
    ],


    // ignore: ["tests/import.test.js"],
    // parallel: true,
    timeout: 15000, // defaults to 2000ms; increase if needed
    checkLeaks: true,

    allowUncaught: true, // Allow uncaught errors to propagate
    jobs: 1, // Number of concurrent jobs for --parallel; use 1 to run in serial; default: (number of CPU cores - 1)
    parallel: false, // Run tests in parallel
    retries: 0 // Retry failed tests this many times
}