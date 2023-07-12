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
    checkLeaks: true
}