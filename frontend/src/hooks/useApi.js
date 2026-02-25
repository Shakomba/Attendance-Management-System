import { useState, useCallback, useEffect } from 'react'

const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export function normalizeApiBase(value) {
    return String(value || '').trim().replace(/\/$/, '')
}

export function toWsBase(apiBase) {
    return normalizeApiBase(apiBase)
        .replace(/^http:\/\//i, 'ws://')
        .replace(/^https:\/\//i, 'wss://')
}

export function useApi() {
    const [apiBase, setApiBase] = useState(() => localStorage.getItem('ams_api_base') || DEFAULT_API_BASE)
    const [health, setHealth] = useState(null)
    const [courses, setCourses] = useState([])
    const [courseId, setCourseId] = useState('')
    const [busy, setBusy] = useState({ loading: false })

    useEffect(() => {
        localStorage.setItem('ams_api_base', normalizeApiBase(apiBase))
    }, [apiBase])

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
