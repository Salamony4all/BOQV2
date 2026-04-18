export const MODEL_OPTIONS = {
    google: {
        gemma: [
            'gemma-4-31b-it',
            'gemma-4-26b-a4b-it',
            'gemma-3-27b-it',
            'gemma-3-12b-it',
            'gemma-3-4b-it',
            'gemma-3n-e4b-it',
            'gemma-3n-e2b-it'
        ],
        gemini: [
            'gemini-2.5-pro',
            'gemini-2.5-flash',
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite',
            'gemini-3-flash-preview',
            'gemini-3.1-pro-preview',
            'gemini-flash-latest',
            'gemini-1.5-pro',
            'gemini-1.5-flash'
        ],
        paid: [
            'gemini-4-pro',
            'gemini-4-flash',
            'gemini-3.1-pro',
            'gemini-3.1-flash',
            'gemini-2.5-pro',
            'gemini-2.5-flash',
            'gemini-2.0-pro',
            'gemini-2.0-flash',
            'gemini-2.0-flash-lite',
            'gemini-1.5-pro-001',
            'gemini-1.5-pro-002',
            'gemini-1.5-flash-001',
            'gemini-1.5-flash-002',
            'gemini-1.0-pro'
        ]
    },
    openrouter: [
        'google/gemini-2.5-flash-lite-001',
        'anthropic/claude-opus-4.6-fast',
        'anthropic/claude-opus-4',
        'anthropic/claude-sonnet-4-20250514',
        'openai/gpt-4-vision-preview',
        'openai/gpt-4-turbo-vision'
    ],
    nvidia: [
        'nvidia/llama-3.3-70b-instruct',
        'nvidia/llama-3.1-70b-instruct',
        'nvidia/nemotron-3-super-120b-a12b',
        'nvidia/gemma-4-31b-it',
        'nvidia/cosmos-transfer2_5-2b',
        'nvidia/llama-3.1-nemotron-nano-8b-v1',
        'nvidia/llama-3.1-nemotron-70b-reward',
        'nvidia/llama-3.1-nemotron-ultra-253b-v1',
        'nvidia/llama-3.3-nemotron-super-49b-v1',
        'nvidia/llama-3.3-nemotron-super-49b-v1.5'
    ],
    local: ['llama3.2']
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
