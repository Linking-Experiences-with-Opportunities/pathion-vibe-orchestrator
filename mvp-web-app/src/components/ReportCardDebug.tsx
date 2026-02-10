'use client';

import { useEffect } from 'react';
import {
    createReportCardFromLLM,
    createReportCardFromParagraph,
    reviseReportCard,
    interpretReportCard,
    listReportCards,
    archiveReportCard,
    getMyReportCards
} from '@/lib/reportCardsClient';

export default function ReportCardDebug() {
    useEffect(() => {
        if (typeof window === 'undefined') return;

        // Expose report card methods to window
        (window as any).reportCards = {
            create: async (model?: string, sessionWindow = 20, promptContext?: string) => {
                console.log("Creating report card (LLM)...");
                try {
                    const res = await createReportCardFromLLM({ model, sessionWindow, promptContext });
                    console.log("Result:", res);
                    return res;
                } catch (e) {
                    console.error("Error creating report card:", e);
                }
            },
            createFromText: async (paragraph: string) => {
                console.log("Creating report card (Manual)...");
                try {
                    const res = await createReportCardFromParagraph(paragraph);
                    console.log("Result:", res);
                    return res;
                } catch (e) {
                    console.error("Error creating report card:", e);
                }
            },
            revise: async (reportId: string, paragraph: string, reason?: string) => {
                console.log(`Revising report ${reportId}...`);
                try {
                    const res = await reviseReportCard(reportId, paragraph, reason);
                    console.log("Result:", res);
                    return res;
                } catch (e) {
                    console.error("Error revising report report:", e);
                }
            },
            interpret: async (reportId?: string) => {
                console.log(`Interpreting report ${reportId || "latest"}...`);
                try {
                    const res = await interpretReportCard(reportId);
                    console.log("Result:", res);
                    return res;
                } catch (e) {
                    console.error("Error interpreting report:", e);
                }
            },
            list: async (includeArchived = false) => {
                console.log("Fetching report cards...");
                try {
                    const res = await listReportCards(includeArchived);
                    console.log("Report Cards:", res);
                    return res;
                } catch (e) {
                    console.error("Error listing report cards:", e);
                }
            },
            get: async (reportId: string) => {
                // We can reuse list() loosely or fetch specifically if endpoints supported it directly,
                // but 'manage:get' is supported by our client lib via runReportCardJob('manage', { action: 'get' ... })
                // actually listReportCards helper is specific to list. 
                // Let's implement a direct get via the generic job runner if needed, 
                // OR just filter from getMyReportCards for simplicity if the list is small.
                // The backend supports action: 'get'.
                // But reportCardsClient.ts doesn't export a `getReportCard` function specifically? 
                // It exports `listReportCards`. 
                // Let's check `reportCardsClient.ts` imports again. 
                // Actually I'll just use runReportCardJob directly if needed, but let's stick to what's exported or easy.
                // The implementation plan mentioned `get` calls `getReportCard`? 
                // Let's check imports.
                // Ah, in ReportCardDebug above I imported: createReportCardFromLLM, revise..., etc. 
                // I will implement a quick helper here or use list.
                console.log(`Fetching report ${reportId}...`);
                try {
                    // For now, let's just use the direct fetch since we have the token logic in client lib
                    // Actually, let's just use list and filter since it's easier and likely small data.
                    const list = await listReportCards(true);
                    const found = list.reports.find((r: any) => r.reportId === reportId);
                    console.log("Result:", found || "Not found");
                    return found;
                } catch (e) {
                    console.error("Error getting report:", e);
                }
            },
            archive: async (reportId: string) => {
                console.log(`Archiving report ${reportId}...`);
                try {
                    const res = await archiveReportCard(reportId);
                    console.log("Result:", res);
                    return res;
                } catch (e) {
                    console.error("Error archiving report:", e);
                }
            }
        };

        console.log(`
      🎓 Report Card Console Tools Loaded 🎓
      
      Usage:
      await window.reportCards.create(model?, window?, context?)
      await window.reportCards.createFromText(paragraph)
      await window.reportCards.revise(id, paragraph, reason?)
      await window.reportCards.interpret(id?)
      await window.reportCards.list(includeArchived?)
      await window.reportCards.get(id)
      await window.reportCards.archive(id)
    `);

        return () => {
            // Cleanup if needed
            delete (window as any).reportCards;
        };
    }, []);

    return null;
}
