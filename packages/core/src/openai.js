import OpenAI from "openai";

export function getOpenAI() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("missing OPENAI_API_KEY");
    return new OpenAI({ apiKey: key });
}