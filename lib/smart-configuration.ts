import { Request, Response } from "express"
import { getRequestBaseURL } from "."


export default function getWellKnownSmartConfig(req: Request, res: Response) {
    
    const baseUrl = getRequestBaseURL(req);
    
    res.json({
        authorization_endpoint: `${baseUrl}/auth/authorize`,
        grant_types_supported: [
            "authorization_code"
        ],
        token_endpoint: `${baseUrl}/auth/token`,
        scopes_supported: [
            "offline_access",
            "patient/$ehi-export"
        ],
        response_types_supported: [
            "code",
            "refresh_token"
        ],
        capabilities: [
            "client-public",
            "context-passthrough-banner",
            "context-passthrough-style",
            "context-standalone-patient",
            "permission-offline",
            "permission-patient",
            "permission-v1",
        ]
    });
}
