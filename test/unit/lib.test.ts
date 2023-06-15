import { expect }                             from "chai"
import { basename, join }                     from "path"
import config                                 from "../../config"
import { getPrefixedFilePath, humanName, validateParam } from "../../lib"
import { OAuthError }                         from "../../lib/errors"
import ExportJob                              from "../../lib/ExportJob"
import { check }                              from "../../lib/ExportJobManager"
import { FIRST_PATIENT_ID }                   from "../integration/TestContext"

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

    describe("getPrefixedFilePath", () => {

        it ("works once", () => {
            const name1 = "my-unique-name"
            const name2 = getPrefixedFilePath(".", name1)
            expect(name2).to.equal(name1)
        })

        it ("works twice", () => {
            const name1 = basename(__filename)
            const name2 = getPrefixedFilePath(__dirname, name1)
            expect(name2).to.equal(join(__dirname, "1." + name1))
        })
    })

    describe("jobs", () => {

        it ("destroy", async () => {
            const job = await ExportJob.create(FIRST_PATIENT_ID)
            await job.destroy()
        })

        it ("destroyIfNeeded for aborted jobs", async () => {
            const job = await ExportJob.create(FIRST_PATIENT_ID)
            job.status = "aborted"
            await ExportJob.destroyIfNeeded(job.id)
        })

        it ("destroyIfNeeded for rejected jobs", async () => {
            const job = await ExportJob.create(FIRST_PATIENT_ID)
            job.status = "rejected"
            await job.save()
            await ExportJob.destroyIfNeeded(job.id)
        })

        it ("destroyIfNeeded for retrieved jobs", async () => {
            const job = await ExportJob.create(FIRST_PATIENT_ID)
            job.status = "retrieved"
            await job.save()
            await ExportJob.destroyIfNeeded(job.id)
        })

        it ("destroyIfNeeded for in-review jobs", async () => {
            const job = await ExportJob.create(FIRST_PATIENT_ID)
            job.status = "in-review"
            await job.save()
            await ExportJob.destroyIfNeeded(job.id)
        })

        it ("destroyIfNeeded for jobs awaiting input", async () => {
            const job = await ExportJob.create(FIRST_PATIENT_ID)
            job.status = "awaiting-input"
            // @ts-ignore
            job.createdAt = Date.now() - config.jobMaxLifetimeMinutes * 60001
            await job.save()
            await ExportJob.destroyIfNeeded(job.id)
        })

        it ("check for aborted jobs", async () => {
            const job = await ExportJob.create(FIRST_PATIENT_ID)
            job.status = "aborted"
            await job.save()
            await check("test-jobs")
        }) 

    })

    describe("humanName", () => {

        it ("humanName({}) -> 'No Name Listed'", () => {
            expect(humanName({} as any)).to.equal("No Name Listed")
        })

        it ("humanName({ name: [] }) -> 'No Name Listed'", () => {
            expect(humanName({ name: [] } as any)).to.equal("No Name Listed")
        })

        it ("humanName({ name: { family: 'a' }}) -> 'a'", () => {
            expect(humanName({ name: { family: 'a' } } as any)).to.equal("a")
        })

        it ("humanName({ name: [{ family: 'a' }]}) -> 'a'", () => {
            expect(humanName({ name: [{ family: 'a' }] } as any)).to.equal("a")
        })

        it ("humanName({ name: [{ given: 'g', suffix: 's' }]}) -> 'g, s'", () => {
            expect(humanName({ name: [{ given: 'g', suffix: 's' }]} as any)).to.equal("g, s")
        })

        it ("humanName({ name: [{ given: 'g', family: ['f', 'f'], suffix: 's' }]}) -> 'g f f, s'", () => {
            expect(humanName({ name: [{ given: 'g', family: ['f', 'f'], suffix: 's' }]} as any)).to.equal("g f f, s")
        })
    })
})