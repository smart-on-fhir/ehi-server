import { expect } from "chai"
import { validateParam } from "../../../lib"
import { OAuthError } from "../../../lib/errors"

describe("lib", () => {
    describe("validateParam", () => {

        it ("Throws if param is missing", () => {
            expect(() => validateParam({}, "x", "abc")).to.throw();
        })
        
        it ("Works with string", () => {
            expect(() => validateParam({ x: "abc" }, "x", "abc")).to.not.throw();
            expect(() => validateParam({ x: "abc" }, "x", "ab")).to.throw();
        })

        it ("Works with RegExp", () => {
            expect(() => validateParam({ x: "abc" }, "x", /^abc$/)).to.not.throw();
            expect(() => validateParam({ x: "abc" }, "x", /^ab$/)).to.throw();
        })

        it ("Works with function that throws OAuthError", () => {
            expect(() => validateParam({ x: "abc" }, "x", () => {
                throw new OAuthError("xxx")
            })).to.throw('xxx');
        })

        it ("Works with function that throws Error", () => {
            expect(() => validateParam({ x: "abc" }, "x", () => {
                throw new Error("xxx")
            })).to.throw('Invalid "x" parameter: xxx');
        })

        it ("Works with function that returns false", () => {
            expect(() => validateParam({ x: "abc" }, "x", () => false))
                .to.throw('Invalid "x" parameter');
        })
    })
})