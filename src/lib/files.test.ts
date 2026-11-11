import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { DOCX, sniffType } from "./files";
import { cvFileKind } from "./intake";

const docx = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8("<w:document/>") });
const xlsx = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "xl/workbook.xml": strToU8("<workbook/>") });
const plainZip = zipSync({ "cv.pdf": strToU8("%PDF-1.4") });

describe("CV file types", () => {
  it("accepts PDF, Word .docx, JPEG, PNG, WebP by their bytes", () => {
    expect(sniffType(strToU8("%PDF-1.7 ..."))).toBe("application/pdf");
    expect(sniffType(docx)).toBe(DOCX);
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(sniffType(strToU8("RIFF0000WEBPVP8 "))).toBe("image/webp");
  });
  it("refuses other Office files, plain ZIPs, old .doc, programs and text", () => {
    expect(sniffType(xlsx)).toBeNull();
    expect(sniffType(plainZip)).toBeNull();
    expect(sniffType(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBeNull(); // .doc (OLE)
    expect(sniffType(strToU8("MZ\x90\x00"))).toBeNull(); // .exe
    expect(sniffType(strToU8("hello"))).toBeNull();
  });
  it("the browser-side check matches type or extension", () => {
    expect(cvFileKind({ name: "cv.docx", type: DOCX })).toBe("docx");
    expect(cvFileKind({ name: "CV.DOCX", type: "" })).toBe("docx");
    expect(cvFileKind({ name: "cv.pdf", type: "application/pdf" })).toBe("pdf");
    expect(cvFileKind({ name: "scan.jpg", type: "image/jpeg" })).toBe("image");
    expect(cvFileKind({ name: "cv.doc", type: "application/msword" })).toBeNull();
    expect(cvFileKind({ name: "cv.exe", type: "application/x-msdownload" })).toBeNull();
    expect(cvFileKind({ name: "cv.docx.exe", type: "" })).toBeNull();
  });
});
