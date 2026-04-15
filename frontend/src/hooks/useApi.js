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
        const envUrl = import.meta.env.VITE_API_BASE_URL
        if (envUrl) return envUrl
        // Default: backend runs on port 8000 on the same host
        return `${window.location.protocol}//${window.location.hostname}:8000`
    })

    const [health, setHealth] = useState(null)
    const [courses, setCourses] = useState([])
    const [courseId, setCourseId] = useState('1')
    const [busy, setBusy] = useState({ loading: false })

    const apiFetch = useCallback(
        async (path, options = {}) => {
            const { _raw, ...fetchOptions } = options
            const token = localStorage.getItem('ams_token') || ''
            const authHeader = token ? { 'Authorization': `Bearer ${token}` } : {}
            // Don't set Content-Type for FormData — let the browser add the boundary
            const contentType = fetchOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }
            const response = await fetch(`${normalizeApiBase(apiBase)}${path}`, {
                headers: {
                    ...contentType,
                    ...authHeader,
                    ...(fetchOptions.headers || {}),
                },
                ...fetchOptions,
            })
            if (_raw) {
                if (!response.ok) {
                    const text = await response.text()
                    throw new Error(text || `HTTP ${response.status}`)
                }
                return response
            }
            const text = await response.text()
            const data = text ? JSON.parse(text) : null
            if (!response.ok) {
                if (response.status === 401 && token) {
                    localStorage.removeItem('ams_token')
                    localStorage.removeItem('ams_professor')
                    window.location.reload()
                }
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
                if (!allCourses.length) return '1'
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
