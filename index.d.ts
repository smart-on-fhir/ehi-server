declare namespace SMART {

    // For the purpose of this prototype we only support public and
    // confidential-symmetric clients
    type SMARTClientType = "public" | "confidential-symmetric"
    
    interface AuthorizeParams {
        response_type: "code" | "token"
        client_id: string
        redirect_uri: string
        launch?: string
        scope: string
        state: string
        aud: string

        code_challenge_method?: "S256"
        code_challenge?: string
        // jwks_url?: string
        
        // These can be set by dialogs
        patient?: string
        provider?: string
        encounter?: string
        auth_success?: "0" | "1"
        login_success?: string


        nonce?: string
    }

    /**
     * Once an app is authorized, the token response will include any context
     * data the app requested and any (potentially) unsolicited context data the
     * EHR may decide to communicate. For example, EHRs may use launch context
     * to communicate UX and UI expectations to the app (need_patient_banner).
     */
    interface LaunchContext {

        /**
         * Boolean value indicating whether the app was launched in a UX context
         * where a patient banner is required (when true) or not required (when
         * false). An app receiving a value of false should not take up screen
         * real estate displaying a patient banner.
         */
        need_patient_banner?: boolean

        /**
         * String value with a patient id, indicating that the app was launched
         * in the context of FHIR Patient 123. If the app has any patient-level
         * scopes, they will be scoped to Patient 123.
         */
        patient?: string
        
        /**
         * String value with an encounter id, indicating that the app was
         * launched in the context of FHIR Encounter 123.
         */
        encounter?: string

        /**
         * String URL where the EHR’s style parameters can be retrieved (for
         * apps that support styling)
         */
        smart_style_url?: string

    }

    /**
     * The authorization token (for example the one that is represented as `code`
     * parameter in the code flow)
     */
    interface AuthorizationToken extends LaunchContext {
        context: LaunchContext,

        /**
         * The client_id of the app being launched
         */
        client_id: string

        /**
         * The scopes requested bu the app
         */
        scope: string

        /**
         * The code_challenge_method used by the app
         */
        code_challenge_method?: string

        /**
         * The code_challenge used by the app
         */
        code_challenge?: string
        
        redirect_uri: string

        /**
         * The selected user ID (if any)
         * @example `Patient/123` or `Practitioner/123`
         */
        user?: string

        client_type?: SMARTClientType

    }

    /**
     * The shape of the response of the token endpoint.
     */
    interface TokenResponse {
        
        token_type: "Bearer"

        access_token: string

        /**
         * Lifetime in seconds of the access token, after which the token SHALL
         * NOT be accepted by the resource server
         */
        expires_in?: number

        /**
         * Scope of access authorized. Note that this can be different from the
         * scopes requested by the app.
         */
        scope: string

        /**
         * Token that can be used to obtain a new access token, using the same
         * or a subset of the original authorization grants. If present, the
         * app should discard any previous refresh_token associated with this
         * launch and replace it with this new value.
         */
        refresh_token?: string
    }

    /**
     * The shape of the response of the token endpoint.
     */
    interface AccessTokenResponse extends TokenResponse, LaunchContext {
        
        /**
         * Authenticated user identity and user details, if requested
         */
        id_token?: string
    }
}

declare namespace EHI {

    interface ExportManifest {
        transactionTime: string
        requiresAccessToken: boolean
        output: ExportManifestFileEntry[]
        error: any[]
    }

    interface ExportManifestFileEntry {
        type  : string
        url   : string
        count?: number
    }

    /**
     * Can be:
     * 
     * - `awaiting-input` - The user needs to fill in the form.
     * 
     * - `in-review` - After the form is submitted successfully no more actions
     *   are required by the user. Then the job switches to "in-review" status,
     *   meaning that it is waiting for the admin to approve or reject the export.
     * 
     * - `requested` - After the export is approved by the admin and while the
     *   data is being exported.
     * 
     * - `retrieved` - All the data transmitted to its destination.
     * 
     * - `aborted` - The admin or the patient aborted/canceled this export.
     * 
     * - `rejected` - The admin rejected this export.
     * 
     * 
     * **Note** that jobs have certain lifetime. Once they expire they will be
     * deleted within the next `config.jobCleanupMinutes` minutes:
     * 
     * - `awaiting-input` - Does not expire
     * - `in-review`      - Expire after `config.jobMaxLifetimeMinutes`
     * - `requested`      - Expire after `config.jobMaxLifetimeMinutes`
     * - `retrieved`      - Expire after `config.jobMaxLifetimeMinutes`
     * - `aborted`        - Expire immediately
     * - `rejected`       - Expire immediately
     */
    type ExportJobStatus =  "awaiting-input" |
                            "in-review" |
                            "requested" |
                            "retrieved" |
                            "aborted"   |
                            "rejected";

    /**
     * The JSON representation of an export job
     */
    interface ExportJob {
        
        /**
         * Random 8 char hex job ID  
         */
        id: string

        /**
         * The ID of the exported patient
         */
        patientId: string

        /**
         * The bulk data export manifest if available. This will be null until
         * the export is approved and started (until it enters "requested" state) 
         */
        manifest: ExportManifest | null

        /**
         * The job status
         */
        status: ExportJobStatus
        
        /**
         * The JS timestamp showing when this job was created
         */
        createdAt: number

        /**
         * The JS timestamp showing when this job was completed, or `0` if it
         * hasn't been completed yet
         */
        completedAt: number
    }

}

export as namespace SMART
export as namespace EHI
