import { useState, useCallback, useEffect } from 'react'

export function normalizeApiBase(value) {
    return String(value || '').trim().replace(/\/$/, '')
}

export function toWsBase(apiBase) {
    return normalizeApiBase(apiBase)
        .replace(/^http:\/\//i, 'ws://')
        .replace(/^https:\/\//i, 'wss://')
}

export function useApi() {
    const [apiBase, setApiBase] = useState(() => {
        const envUrl = import.meta.env.VITE_API_BASE_URL;

        // If we are accessing via local IP or localhost, dynamically point to port 8000
        if (!window.location.hostname.includes('shakomba.org')) {
            return `${window.location.protocol}//${window.location.hostname}:8000`;
        }

        // On production domain, use the compiled env URL or default fallback
        return envUrl || 'https://api.shakomba.org';
    })

    const [health, setHealth] = useState(null)
    const [courses, setCourses] = useState([])
    const [courseId, setCourseId] = useState('')
    const [busy, setBusy] = useState({ loading: false })

    const apiFetch = useCallback(
        async (path, options = {}) => {
            const response = await fetch(`${normalizeApiBase(apiBase)}${path}`, {
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
                ...options
            })
            const text = await response.text()
            const data = text ? JSON.parse(text) : null
            if (!response.ok) {
                throw new Error(data?.detail || data?.message || text || `HTTP ${response.status}`)
            }
            return data
        },
        [apiBase]
    )

    const loadBootstrap = useCallback(async ({ silent = false } = {}) => {
        if (!silent) setBusy((prev) => ({ ...prev, loading: true }))
        try {
            const [healthRes, courseRes] = await Promise.all([apiFetch('/api/health'), apiFetch('/api/courses')])
            setHealth(healthRes)
            const allCourses = courseRes?.items || []
            setCourses(allCourses)
            setCourseId((prev) => {
                if (!allCourses.length) return ''
                const hasPrev = allCourses.some((course) => String(course.CourseID) === String(prev))
                return hasPrev ? prev : String(allCourses[0].CourseID)
            })
            return true
        } catch (err) {
            console.error('Bootstrap failed:', err.message)
            return false
        } finally {
            if (!silent) setBusy((prev) => ({ ...prev, loading: false }))
        }
    }, [apiFetch])

    return {
        apiBase,
        setApiBase,
        apiFetch,
        health,
        courses,
        courseId,
        setCourseId,
        busy,
        loadBootstrap
    }
}
