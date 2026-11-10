import { z } from "zod";
import { jobStatusEnum } from "@/db/schema";
import { CERTIFICATIONS } from "@/lib/options";

const years = (what: string) => z.int(`${what} must be whole years`).min(0, `${what} can't be negative`).max(45, `${what} is too high`).nullable();

/** One job as edited in Settings (create and update send the whole row). */
export const JobInput = z
  .object({
    title: z.string("Enter a job title").trim().min(2, "Enter a job title").max(100, "Title is too long"),
    status: z.enum(jobStatusEnum.enumValues, "Choose open, paused or closed"),
    openings: z.int("Openings must be a whole number").min(0, "Openings can't be negative").max(1000, "Openings is too high").nullable(),
    minExperienceYears: years("Minimum experience"),
    maxExperienceYears: years("Maximum experience"),
    requiredCertifications: z.array(z.enum(CERTIFICATIONS, "Unknown certification")).transform((v) => [...new Set(v)]),
  })
  .refine((j) => j.minExperienceYears === null || j.maxExperienceYears === null || j.minExperienceYears <= j.maxExperienceYears, {
    message: "Minimum experience can't be more than the maximum",
    path: ["maxExperienceYears"],
  });

export type JobInputData = z.output<typeof JobInput>;
