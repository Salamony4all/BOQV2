export const MODEL_OPTIONS = {
    google: {
        gemma: [
            'gemma-4-31b-it',
            'gemma-4-26b-a4b-it',
            'gemma-4-e4b-it',
            'gemma-4-e2b-it',
            'gemma-4-9b-it',
            'gemma-4-2b-it',
            'gemma-2-27b-it',
            'gemma-2-9b-it',
            'gemma-2-2b-it'
        ],
        gemini: [
            'gemini-3-flash',
            'gemini-3-flash-8b',
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite',
            'gemini-1.5-flash',
            'gemini-1.5-pro',
            'gemini-1.0-pro'
        ],
        paid: [
            'gemini-3.1-pro',
            'gemini-3-pro',
            'gemini-2.5-pro',
            'gemini-2.0-pro',
            'gemini-1.5-pro-002',
            'gemini-1.5-flash-002',
            'gemini-1.5-pro-001'
        ]
    },
    openrouter: [
        'google/gemini-2.5-flash-lite-001',
        'google/gemini-4-31b-it:free',
        'google/gemma-4-26b-a4b-it:free',
        'google/gemma-4-31b-it:free',
        'google/gemini-2.5-pro',
        'anthropic/claude-opus-4.6-fast',
        'anthropic/claude-opus-4',
        'anthropic/claude-sonnet-4-20250514',
        'openai/gpt-4-vision-preview',
        'openai/gpt-4-turbo-vision',
        'z-ai/glm-5.1',
        'cohere/rerank-4-pro'
    ],
    nvidia: [
        'nvidia/google/gemma-4-31b-it',
        'nvidia/google/gemma-4-26b-a4b-it',
        'nvidia/google/gemma-4-e4b-it',
        'nvidia/google/gemma-4-e2b-it',
        'nvidia/google/gemma-2-9b-it',
        'nvidia/google/gemma-2-27b-it',
        'nvidia/meta/llama-3.3-70b-instruct',
        'nvidia/meta/llama-3.1-405b-instruct',
        'nvidia/meta/llama-3.1-70b-instruct',
        'nvidia/nvidia/llama-3.1-nemotron-70b-instruct',
        'nvidia/nvidia/neva-22b',
        'nvidia/nvidia/vila',
        'nvidia/nvidia/vlia'
    ],
    local: ['local/yolov8-llama3.2', 'llama3.2']
};

export const AI_ENGINES = [
    { id: 'google',     name: 'Google AI',         desc: 'Standard Google models', icon: 'AI', color: '#1a73e8' },
    { id: 'local',      name: 'Local LLM',         desc: 'Offline Capability',     icon: 'LL', color: '#b91c1c' },
    { id: 'openrouter', name: 'OpenRouter',        desc: 'Model Gateway',          icon: 'OR', color: '#8b5cf6' },
    { id: 'nvidia',     name: 'NVIDIA',            desc: 'High Performance AI',    icon: 'NV', color: '#76b900' }
];

export const DEFAULT_AI_SETTINGS = {
    engine: 'google',
    model: 'gemma-4-31b-it'
};
