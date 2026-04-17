import { useState, useCallback } from "react";

export function useEmail(apiFetch) {
    const [sending, setSending] = useState(false);
    const [lastResult, setLastResult] = useState(null);

    const sendBulkEmail = useCallback(
        async (courseId, studentIds, emailType) => {
            if (!courseId || !studentIds?.length || !emailType) return null;
            setSending(true);
            setLastResult(null);
            try {
                const lang = window.localStorage.getItem("app_lang") || "en";
                const result = await apiFetch(
                    `/api/courses/${courseId}/emails/send`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            student_ids: studentIds,
                            email_type: emailType,
                            lang: lang,
                        }),
                    }
                );
                setLastResult(result);
                return result;
            } catch (err) {
                const errorResult = {
                    total: studentIds.length,
                    sent: 0,
                    failed: studentIds.length,
                    results: [],
                    error: err.message,
                };
                setLastResult(errorResult);
                return errorResult;
            } finally {
                setSending(false);
            }
        },
        [apiFetch]
    );

    const clearResult = useCallback(() => setLastResult(null), []);

    return { sending, lastResult, sendBulkEmail, clearResult };
}
