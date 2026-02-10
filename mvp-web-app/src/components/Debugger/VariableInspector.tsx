
import React from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface VariableInspectorProps {
  variables: Record<string, any>;
}

/** Safely render a primitive value with type-appropriate coloring. */
function renderValue(val: unknown): React.ReactNode {
  if (val === null) return <span className="text-zinc-500 italic">None</span>;
  if (val === undefined) return <span className="text-zinc-500 italic">undefined</span>;
  if (typeof val === 'string') return <span className="text-green-400">&quot;{val}&quot;</span>;
  if (typeof val === 'number') return <span className="text-blue-400">{val}</span>;
  if (typeof val === 'boolean') return <span className="text-purple-400">{val ? 'True' : 'False'}</span>;
  // Fallback for functions, symbols, bigint, etc.
  return <span className="text-zinc-300">{String(val)}</span>;
}

/**
 * Safely extract the entries of an object value for rendering.
 * Guards against circular references and non-iterable objects.
 */
function safeEntries(value: unknown): [string, unknown][] {
  if (typeof value !== 'object' || value === null) return [];
  try {
    return Object.entries(value);
  } catch {
    return [['[error]', '[could not enumerate properties]']];
  }
}

export const VariableInspector: React.FC<VariableInspectorProps> = ({ variables }) => {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({ 'self': true });

  const toggleExpand = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const safeVariables = variables ?? {};

  return (
    <div className="flex-grow overflow-y-auto custom-scrollbar">
      <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/10">
        <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Variables</span>
      </div>
      <div className="p-2 space-y-0.5 font-mono text-xs">
        {Object.entries(safeVariables).map(([key, value]) => {
          const isObject = typeof value === 'object' && value !== null;
          
          return (
            <div key={key} className="flex flex-col">
              <div 
                className={`flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-800/50 cursor-pointer group ${isObject ? '' : 'pl-6'}`}
                onClick={() => isObject && toggleExpand(key)}
              >
                {isObject && (
                  expanded[key] ? <ChevronDown size={12} className="text-zinc-500" /> : <ChevronRight size={12} className="text-zinc-500" />
                )}
                <span className="text-blue-400 font-bold">{key}</span>
                <span className="text-zinc-600">=</span>
                {!isObject ? renderValue(value) : (
                  <span className="text-zinc-500 italic">
                    {Array.isArray(value) ? `Array(${value.length})` : 'Object'}
                  </span>
                )}
              </div>
              
              {isObject && expanded[key] && (
                <div className="ml-6 border-l border-zinc-800 pl-2 mt-0.5 space-y-0.5">
                  {safeEntries(value).map(([childKey, childValue]) => (
                    <div key={childKey} className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-800/30">
                       <span className="text-zinc-400">{childKey}</span>
                       <span className="text-zinc-600">:</span>
                       {typeof childValue === 'object' && childValue !== null
                         ? <span className="text-zinc-500 italic">{Array.isArray(childValue) ? `Array(${childValue.length})` : 'Object'}</span>
                         : renderValue(childValue)
                       }
                    </div>
                  ))}
                  {safeEntries(value).length === 0 && (
                    <div className="px-2 py-1 text-zinc-600 italic">empty</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {Object.keys(safeVariables).length === 0 && (
            <div className="p-4 text-center text-zinc-600 italic">
                No variables in scope
            </div>
        )}
      </div>
    </div>
  );
};
