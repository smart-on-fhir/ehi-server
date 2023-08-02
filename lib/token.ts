import { Request, Response } from "express"
import jwt from "jsonwebtoken"
import config from "../config"
import { SMART } from "../index"
import { getRequestBaseURL, requireUrlencodedPost } from "./utils"
import {
    InvalidClientError,
    InvalidRequestError,
    InvalidScopeError,
    OAuthError
} from "./errors"


export class TokenHandler {

    protected request: Request;

    protected response: Response;

    protected baseUrl: string;

    protected constructor(req: Request, res: Response) {
        this.request = req;
        this.response = res;
        this.baseUrl = getRequestBaseURL(req)
    }

    /**
     * This is the typical public static entry point designed to be easy to use
     * as route handler. 
     */
    public static handle(req: Request, res: Response) {
        return new TokenHandler(req, res).handle();
    }

    /**
     * Validates that the request is form-urlencoded" POST and then uses the
     * grant_type parameter to pick the right flow
     */
    public async handle(): Promise<void> {
        const req = this.request;

        requireUrlencodedPost(req);

        switch (req.body.grant_type) {
            case "authorization_code":
                return await this.handleAuthorizationCode();
            case "refresh_token":
                return this.handleRefreshToken();
            default:
                throw new OAuthError('Invalid or missing grant_type parameter "%s"', req.body.grant_type)
                    .errorId("unsupported_grant_type")
                    .status(400);
        }
    }

    /**
     * Handles the common authorization requests. Parses and validates
     * token from request.body.code and eventually calls this.finish() with it.
     */
    public async handleAuthorizationCode(): Promise<void> {
        const payload = this.request.body as any

        const { code, redirect_uri } = payload

        // Require code param
        if (!code) {
            throw new InvalidClientError("Missing 'code' parameter").status(400)
        }

        // Require redirect_uri param
        if (!redirect_uri) {
            throw new InvalidRequestError("Missing 'redirect_uri' parameter").status(400)
        }

        // Verify code
        try {
            var authorizationToken = jwt.verify(code, config.jwtSecret) as SMART.AuthorizationToken
        } catch (ex) {
            throw new InvalidClientError("Invalid token (supplied as code parameter in the POST body). %s", (ex as Error).message).status(401)
        }

        // Require authorizationToken.redirect_uri
        if (!authorizationToken.redirect_uri) {
            throw new InvalidClientError("The authorization token must include redirect_uri").status(401);
        }

        // Require authorizationToken.redirect_uri to equal payload.redirect_uri
        if (authorizationToken.redirect_uri !== redirect_uri) {
            throw new InvalidRequestError("Invalid redirect_uri parameter").status(401);
        }

        // Require authorizationToken.scope
        if (!authorizationToken.scope) {
            throw new InvalidScopeError("The authorization token must include scope").status(401);
        }

        return this.finish(authorizationToken);
    }

    /**
     * Handles the refresh_token authorization requests. Parses and validates
     * token from request.body.refresh_token and eventually calls this.finish()
     * with it.
     */
    public handleRefreshToken(): void {
        try {
            var token: any = jwt.verify(this.request.body.refresh_token, config.jwtSecret)
        } catch (ex) {
            throw new OAuthError("Invalid refresh token").errorId("invalid_grant").status(401)
        }
        return this.finish(token);
    }

    public generateRefreshToken(code: SMART.AuthorizationToken): string {
        let token = {
            context: code.context,
            // client_id: code.client_id,
            scope: code.scope,
            user: code.user,
            // iat: code.iat,
        };

        return jwt.sign(token, config.jwtSecret, {
            expiresIn: +config.refreshTokenLifeTime * 60
        });
    }

    /**
     * Generates and sends the response
     */
    public finish(authorizationToken: SMART.AuthorizationToken) {

        const res = this.response;

        const { scope } = authorizationToken;

        const expiresIn = +config.accessTokenLifetime * 60;

        const tokenResponse: SMART.AccessTokenResponse = {
            access_token : "",
            token_type   : "Bearer",
            expires_in   : expiresIn,
            scope        : scope,
            refresh_token: scope.match(/\boffline_access\b/) ||
                           scope.match(/\bonline_access\b/) ?
                this.generateRefreshToken(authorizationToken) :
                undefined,
            ...authorizationToken.context
        };

        // access_token includes settings that might be needed for refresh
        tokenResponse.access_token = jwt.sign({
            scope: authorizationToken.scope
        }, config.jwtSecret, { expiresIn });

        res.set({ "Cache-Control": "no-store", "Pragma": "no-cache" });
        res.json(tokenResponse);
    }
}

