import { useState, useEffect } from 'react';
import { VizPayloadV1 } from '@/lib/vizPayload';

interface GemNano {
    canCreateTextSession: () => Promise<string>;
    createTextSession: (options?: any) => Promise<any>;
}

declare global {
    interface Window {
        ai?: GemNano;
    }
}

export function useVizCaption() {
    const [caption, setCaption] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isAvailable, setIsAvailable] = useState(false);
    const [availabilityStatus, setAvailabilityStatus] = useState<string>('unknown');

    useEffect(() => {
        // Check if window.ai is available
        if (typeof window !== 'undefined' && window.ai) {
            window.ai.canCreateTextSession().then((status) => {
                setAvailabilityStatus(status);
                setIsAvailable(status === 'readily');
            }).catch(() => {
                setAvailabilityStatus('unavailable');
                setIsAvailable(false);
            });
        } else {
            setAvailabilityStatus('unavailable');
        }
    }, []);

    const generateCaption = async (vizPayload: VizPayloadV1['viz']) => {
        if (!vizPayload || !isAvailable || !window.ai) {
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const session = await window.ai.createTextSession();

            // Construct a prompt that forces brevity and technical focus
            // We pass the structure and markers, but maybe stripping styling to save tokens is smart?
            // For now, let's pass the whole thing.
            const prompt = `You are a technical diagram captioner. Describe the following graph structure in one single sentence. Mention if there is a cycle or a disconnected node. Input JSON: ${JSON.stringify(vizPayload)}`;

            const result = await session.prompt(prompt);
            setCaption(result);

            // Clean up session if possible
            if (session.destroy) {
                session.destroy();
            }
        } catch (err) {
            console.error("Gemini Nano generation failed:", err);
            setError("Failed to generate caption.");
        } finally {
            setLoading(false);
        }
    };

    return { generateCaption, caption, loading, error, isAvailable, availabilityStatus };
}
