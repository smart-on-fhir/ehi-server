import jwt        from "jsonwebtoken"
import request    from "supertest"
import config     from "../../config"
import { SERVER } from "./TestContext"


describe("SMART", () => {

    describe("authorize", () => {

        it ('Requires "response_type" parameter', () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .expect("content-type", /\bjson\b/)
            .expect(400, { error: "invalid_request", error_description: 'Missing "response_type" parameter' }));
            
        it ('Requires "response_type" parameter to equal "code"', () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({ response_type: "xyz" })
            .expect("content-type", /\bjson\b/)
            .expect(400, { error: "invalid_request", error_description: 'Invalid "response_type" parameter. Value must be "code".' }));

        it ('Requires "client_id" parameter', () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({ response_type: "code" })
            .expect("content-type", /\bjson\b/)
            .expect(400, { error: "invalid_request", error_description: 'Missing "client_id" parameter' }));
            
        it ('Requires "client_id" parameter to equal "test_client_id"', () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({ response_type: "code", client_id: "whatever" })
            .expect("content-type", /\bjson\b/)
            .expect(400, { error: "invalid_client", error_description: 'The only client_id supported bu this server is "test_client_id".' }));

        it ('Requires "redirect_uri" parameter', () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({ response_type: "code", client_id: "test_client_id" })
            .expect("content-type", /\bjson\b/)
            .expect(400, { error: "invalid_request", error_description: 'Missing "redirect_uri" parameter' }));
            
        it ('Requires "redirect_uri" parameter to be URL', () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({ response_type: "code", client_id: "test_client_id", redirect_uri: "whatever" })
            .expect("content-type", /\bjson\b/)
            .expect(400, { error: "invalid_request", error_description: 'Invalid "redirect_uri" parameter: Invalid URL' }));
        
        it ('Requires "state" parameter', () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({ response_type: "code", client_id: "test_client_id", redirect_uri: "http://x" })
            .expect("content-type", /\bjson\b/)
            .expect(400, { error: "invalid_request", error_description: 'Missing "state" parameter' }));
        
        it ('Requires "aud" parameter', () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({ response_type: "code", client_id: "test_client_id", redirect_uri: "http://x", state: "x" })
            .expect("content-type", /\bjson\b/)
            .expect(400, { error: "invalid_request", error_description: 'Missing "aud" parameter' }));
            
        it ('Requires "aud" parameter to be URL', () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({ response_type: "code", client_id: "test_client_id", redirect_uri: "http://x", state: "x", aud: "y" })
            .expect("content-type", /\bjson\b/)
            .expect(400, { error: "invalid_request", error_description: 'Invalid "aud" parameter: Invalid URL' }));
        
        it ('Requires "scope" parameter', () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({ response_type: "code", client_id: "test_client_id", redirect_uri: "http://x", state: "x", aud: "http://y" })
            .expect("content-type", /\bjson\b/)
            .expect(400, { error: "invalid_request", error_description: 'Missing "scope" parameter' }));

        it ('Requires "scope" parameter to include "patient/$ehi-export"', () => request(SERVER.baseUrl)
            .get("/auth/authorize")     
            .query({ response_type: "code", client_id: "test_client_id", redirect_uri: "http://x", state: "x", aud: "http://y", scope: "x y z" })
            .expect("content-type", /\bjson\b/)
            .expect(400, { error: "invalid_scope", error_description: 'A "patient/$ehi-export" scope must be requested and is the only scope that this server supports' }));

        it ('validates aud', () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({
                response_type: "code",
                client_id    : "test_client_id",
                redirect_uri : "http://x",
                state        : "x",
                aud          : "http://y",
                scope        : "patient/$ehi-export"
            })
            .expect("content-type", /\bjson\b/)
            .expect(400, {
                error: "invalid_request",
                error_description: `Bad audience value "http://y". Expected "${SERVER.baseUrl}/fhir".`
            }));

        it ("requires patient login", () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({
                response_type: "code",
                client_id    : "test_client_id",
                redirect_uri : "http://x",
                state        : "x",
                aud          : SERVER.baseUrl + "/fhir",
                scope        : "patient/$ehi-export"
            })
            .expect(302)
            .expect("location", /\/patient-login\b/));
        
        it ("requires launch authorization", () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({
                response_type: "code",
                client_id    : "test_client_id",
                redirect_uri : "http://x",
                state        : "x",
                aud          : SERVER.baseUrl + "/fhir",
                scope        : "patient/$ehi-export",
                _patient     : "abc"
            })
            .expect(302)
            .expect("location", /\/authorize-app\?.*?_patient=abc\b/));

        it ("aborts launch on rejected authorization", () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({
                response_type: "code",
                client_id    : "test_client_id",
                redirect_uri : "http://x",
                state        : "x",
                aud          : SERVER.baseUrl + "/fhir",
                scope        : "patient/$ehi-export",
                _patient     : "abc",
                _auth_success: "0"
            })
            .expect(401));

        it ("redirects to redirect_uri with code and state", () => request(SERVER.baseUrl)
            .get("/auth/authorize")
            .query({
                response_type: "code",
                client_id    : "test_client_id",
                redirect_uri : "http://x",
                state        : "x",
                aud          : SERVER.baseUrl + "/fhir",
                scope        : "patient/$ehi-export",
                _patient     : "abc",
                _auth_success: "1"
            })
            .expect(302)
            .expect("location", /http:\/\/x\/\?code=.+?&state=x\b/));
    })

    describe("token", () => {

        it ('Requires urlencoded POST', () => request(SERVER.baseUrl)
            .post("/auth/token")
            .expect("content-type", /\bjson\b/)
            .expect(400, {
                error: "invalid_request",
                error_description: "Invalid request content-type header 'undefined' (must be 'application/x-www-form-urlencoded')"
            }));
        
        it ('Requires "grant_type" parameter', () => request(SERVER.baseUrl)
            .post("/auth/token")
            .set("content-type", "application/x-www-form-urlencoded")
            .expect("content-type", /\bjson\b/)
            .expect(400, {
                error: "unsupported_grant_type",
                error_description: 'Invalid or missing grant_type parameter "undefined"'
            }));

        it ('Validates the "grant_type" parameter', () => request(SERVER.baseUrl)
            .post("/auth/token")
            .set("content-type", "application/x-www-form-urlencoded")
            .send({ grant_type: "xyz" })
            .expect("content-type", /\bjson\b/)
            .expect(400, {
                error: "unsupported_grant_type",
                error_description: 'Invalid or missing grant_type parameter "xyz"'
            }));

        it ('Requires "code" parameter', () => request(SERVER.baseUrl)
            .post("/auth/token")
            .set("content-type", "application/x-www-form-urlencoded")
            .send({ grant_type: "authorization_code" })
            .expect("content-type", /\bjson\b/)
            .expect(400, {
                error: "invalid_client",
                error_description: "Missing 'code' parameter"
            }));

        it ('Requires "redirect_uri" parameter', () => request(SERVER.baseUrl)
            .post("/auth/token")
            .set("content-type", "application/x-www-form-urlencoded")
            .send({ grant_type: "authorization_code", code: "xyz" })
            .expect("content-type", /\bjson\b/)
            .expect(400, {
                error: "invalid_request",
                error_description: "Missing 'redirect_uri' parameter"
            }));

        it ('The "code" parameter must be JWT', () => request(SERVER.baseUrl)
            .post("/auth/token")
            .set("content-type", "application/x-www-form-urlencoded")
            .send({ grant_type: "authorization_code", code: "xyz", redirect_uri: "whatever" })
            .expect("content-type", /\bjson\b/)
            .expect(401, /{"error":"invalid_client","error_description":"Invalid token \(supplied as code parameter in the POST body\)\./));

        it ('Requires the "code" token to include redirect_uri', () => request(SERVER.baseUrl)
            .post("/auth/token")
            .set("content-type", "application/x-www-form-urlencoded")
            .send({
                grant_type  : "authorization_code",
                redirect_uri: "whatever",
                code        : jwt.sign({}, config.jwtSecret)
            })
            .expect("content-type", /\bjson\b/)
            .expect(401, {
                error: "invalid_client",
                error_description: "The authorization token must include redirect_uri"
            }));
        
        it ('Requires code.redirect_uri to equal the redirect_uri parameter', () => request(SERVER.baseUrl)
            .post("/auth/token")
            .set("content-type", "application/x-www-form-urlencoded")
            .send({
                grant_type  : "authorization_code",
                redirect_uri: "whatever",
                code        : jwt.sign({ redirect_uri: "xyz" }, config.jwtSecret)
            })
            .expect("content-type", /\bjson\b/)
            .expect(401, {
                error: "invalid_request",
                error_description: "Invalid redirect_uri parameter"
            }));
        
        it ('Requires the "code" token to include scope', () => request(SERVER.baseUrl)
            .post("/auth/token")
            .set("content-type", "application/x-www-form-urlencoded")
            .send({
                grant_type  : "authorization_code",
                redirect_uri: "xyz",
                code        : jwt.sign({ redirect_uri: "xyz" }, config.jwtSecret)
            })
            .expect("content-type", /\bjson\b/)
            .expect(401, {
                error: "invalid_scope",
                error_description: "The authorization token must include scope"
            }));

        it("Generates valid token response", () => request(SERVER.baseUrl)
            .post("/auth/token")
            .set("content-type", "application/x-www-form-urlencoded")
            .send({
                grant_type  : "authorization_code",
                redirect_uri: "xyz",
                code        : jwt.sign({
                    redirect_uri: "xyz",
                    scope: "test-scope"
                }, config.jwtSecret)
            })
            .expect("content-type", /\bjson\b/)
            .expect(200, /"token_type":"Bearer"/))
        
        it("Includes refresh token if needed", () => request(SERVER.baseUrl)
            .post("/auth/token")
            .set("content-type", "application/x-www-form-urlencoded")
            .send({
                grant_type  : "authorization_code",
                redirect_uri: "xyz",
                code        : jwt.sign({
                    redirect_uri: "xyz",
                    scope: "test-scope offline_access"
                }, config.jwtSecret)
            })
            .expect("content-type", /\bjson\b/)
            .expect(200, /"refresh_token"/))
        
        it("Rejects invalid refresh tokens", () => request(SERVER.baseUrl)
            .post("/auth/token")
            .set("content-type", "application/x-www-form-urlencoded")
            .send({ grant_type: "refresh_token", refresh_token: "xyz" })
            .expect("content-type", /\bjson\b/)
            .expect(401, {
                error: "invalid_grant",
                error_description: "Invalid refresh token"
            }))


        it("Includes refresh token requests", () => request(SERVER.baseUrl)
            .post("/auth/token")
            .set("content-type", "application/x-www-form-urlencoded")
            .send({
                grant_type  : "refresh_token",
                refresh_token: jwt.sign({ scope: "test-scope offline_access" }, config.jwtSecret)
            })
            .expect("content-type", /\bjson\b/)
            .expect(200, /"refresh_token"/))
    })
})
