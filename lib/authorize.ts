import jwt                                  from "jsonwebtoken"
import { Request, Response }                from "express"
import config                               from "../config"
import { InvalidClientError, InvalidRequestError, InvalidScopeError } from "./errors"
import { getRequestBaseURL, validateParam } from "."


export default class AuthorizeHandler {

    protected request: Request;

    protected response: Response;

    protected launchOptions = {}

    protected baseUrl: string;

    public static handle(req: Request, res: Response) {
        return new AuthorizeHandler(req, res).authorize();
    }

    public constructor(req: Request, res: Response) {
        this.request  = req
        this.response = res
        this.baseUrl  = getRequestBaseURL(req)
    }

    /**
     * This is used to intercept the authorize flow by redirecting to intermediate
     * page for logging in, selecting a patient, etc. Those pages will then
     * redirect back here.
     * @param to The pathname to redirect to
     * @param query Custom parameters (if any)
     */
    public redirect(to: string, query: Record<string, any> = {}): void {

        const url = new URL(to, this.baseUrl)

        // Make sure we preserve all the authorize params by passing them
        // to the redirect url. Then, the tools at that url should pass them
        // back here
        for (let p in this.request.query) {
            if (this.request.query[p] !== undefined) {
                url.searchParams.set(p, this.request.query[p] + "")
            }
        }

        // Now add any custom params
        for (let p in query) {
            if (query[p]) {
                url.searchParams.set(p, query[p])
            }
        }

        return this.response.redirect(url.href);
    }

    /**
     * Creates and returns the signed JWT code that contains some authorization
     * details.
     */
    public createAuthCode(patient?: string): string {
        return jwt.sign({
            context     : { need_patient_banner: true, patient },
            client_id   : this.request.query.client_id + "",
            redirect_uri: this.request.query.redirect_uri + "",
            scope       : this.request.query.scope + ""
        }, config.jwtSecret, { expiresIn: "5m" });
    }

    public validateAuthorizeRequest(): void
    {
        const { request } = this

        // User decided not to authorize the app launch
        if (request.query._auth_success === "0") {
            throw new InvalidRequestError("Unauthorized").status(401)
        }

        validateParam(request.query, "response_type", "code")
        validateParam(request.query, "client_id", id => {
            if (id !== "test_client_id") {
                throw new InvalidClientError('The only client_id supported bu this server is "test_client_id".')
            }
        })
        validateParam(request.query, "redirect_uri", x => new URL(decodeURIComponent(x)))
        validateParam(request.query, "state")
        validateParam(request.query, "aud", x => new URL(decodeURIComponent(x)))
        validateParam(request.query, "scope", scope => {            
            const scopes = scope.trim().split(/\s+/)
            if (!scopes.includes("patient/$ehi-export")) {
                throw new InvalidScopeError(
                    `A "patient/$ehi-export" scope must be requested and is ` +
                    `the only scope that this server supports`
                )
            }
        })
        
        // The "aud" param must match the apiUrl (but can have different protocol)
        // console.log(req.url, req.baseUrl)
        // const apiUrl = new URL(request.baseUrl.replace(/\/auth.*$/, "/fhir"), this.baseUrl)
        const apiUrl = new URL(request.originalUrl.replace(/\/auth.*$/, "/fhir"), this.baseUrl)
        const apiUrlHref = apiUrl.href

        let audUrl = new URL(decodeURIComponent(request.query.aud + ""))

        apiUrl.protocol = "https:"
        audUrl.protocol = "https:"

        apiUrl.hostname = apiUrl.hostname.replace(/^:\/\/localhost/, "://127.0.0.1")
        audUrl.hostname = apiUrl.hostname.replace(/^:\/\/localhost/, "://127.0.0.1")

        if (apiUrl.href !== audUrl.href) {
            throw new InvalidRequestError('Bad audience value "%s". Expected "%s".', request.query.aud, apiUrlHref)
        }
    }

    /**
     * The authorization server validates the request to ensure that all
     * required parameters are present and valid.  If the request is valid,
     * the authorization server authenticates the resource owner and obtains
     * an authorization decision (by asking the resource owner or by
     * establishing approval via other means).
     */
    public authorize()
    {
        const {
            redirect_uri,
            state,
            _patient,
            _auth_success
        } = this.request.query

        this.validateAuthorizeRequest();

        // PATIENT LOGIN SCREEN
        if (!_patient) {
            return this.redirect("/patient-login")
        }

        // AUTH SCREEN
        if (_auth_success !== "1") {
            return this.redirect("/authorize-app", { _patient })
        }

        // LAUNCH!
        const RedirectURL = new URL(decodeURIComponent(redirect_uri + ""));
        RedirectURL.searchParams.set("code", this.createAuthCode(_patient + ""));
        RedirectURL.searchParams.set("state", state + "");
        this.response.redirect(RedirectURL.href);
    }
}
