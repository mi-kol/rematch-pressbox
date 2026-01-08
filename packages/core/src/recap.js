import slugify from "slugify";
import { Prompt } from "./prompts/journalism.js";
import { getOpenAI } from "./openai.js";

export async function generateRecapFromPacket(packet) {
    const ai = getOpenAI();

    const res = await ai.responses.create({
        model: "gpt-4.1-mini",
        input: [
            {
                role: "system",
                content: Prompt.WriteArticle
            },
            { role: 'user', content: `match packet:\n${JSON.stringify(packet, null, 2)}` }
        ]
    });

    const md = (res.output_text || '').trim();
    const title = packet?.match?.title_hint || 'match recap';
    const slug = slugify(title, { lower: true, strict: true }).slice(0, 70);

    return { title, slug, md }
} 