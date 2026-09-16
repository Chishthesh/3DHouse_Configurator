import React, { useEffect, useMemo, useState } from 'react';

// Browser for everything the .glb contains: top-level nodes and every sub-node under
// them. Selecting a row is what drives the camera and the finish options, so this is
// the app's primary navigation.
export default function NodeTree({ graph, labelFor, selectedId, editedNodeIds, optionCountFor, onSelect }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());

  // Keep the selected row reachable when selection comes from clicking in the 3D view.
  useEffect(() => {
    if (!selectedId || !graph) return;
    setCollapsed((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      let cur = graph.byId.get(selectedId);
      let changed = false;
      while (cur?.parentId) {
        if (next.delete(cur.parentId)) changed = true;
        cur = graph.byId.get(cur.parentId);
      }
      return changed ? next : prev;
    });
  }, [selectedId, graph]);

  const rows = useMemo(() => {
    if (!graph) return [];
    const q = query.trim().toLowerCase();

    // While searching, collapse state is ignored and matches are shown flat with
    // their path — hunting for "tap" shouldn't require knowing where it lives.
    if (q) {
      return graph.nodes
        .filter(
          (n) =>
            n.name.toLowerCase().includes(q) ||
            labelFor(n).toLowerCase().includes(q) ||
            n.materialNames.some((m) => m.toLowerCase().includes(q))
        )
        .map((n) => ({ node: n, indent: 0, hasChildren: false, showPath: true }));
    }

    const out = [];
    const walk = (id, indent) => {
      const node = graph.byId.get(id);
      if (!node) return;
      out.push({ node, indent, hasChildren: node.childIds.length > 0, showPath: false });
      if (!collapsed.has(id)) node.childIds.forEach((cid) => walk(cid, indent + 1));
    };
    graph.roots.forEach((id) => walk(id, 0));
    return out;
  }, [graph, query, collapsed, labelFor]);

  const toggle = (id, e) => {
    e.stopPropagation();
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!graph) return null;

  return (
    <div className="node-tree">
      <div className="tree-toolbar">
        <input
          className="tree-search"
          type="search"
          placeholder="Search parts, materials…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="tree-scroll">
        {rows.length === 0 && <div className="tree-empty">No parts match that search.</div>}
        {rows.map(({ node, indent, hasChildren, showPath }) => {
          const optionCount = optionCountFor(node);
          const isEdited = editedNodeIds.has(node.id);
          return (
            <div
              key={node.id}
              className={`tree-row ${selectedId === node.id ? 'selected' : ''} ${node.autoNamed ? 'auto-named' : ''}`}
              style={{ paddingLeft: 8 + indent * 14 }}
              onClick={() => onSelect(node)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(node);
                }
              }}
            >
              {hasChildren ? (
                <button className="tree-chevron" onClick={(e) => toggle(node.id, e)} aria-label="Expand or collapse">
                  {collapsed.has(node.id) ? '▸' : '▾'}
                </button>
              ) : (
                <span className="tree-chevron placeholder">{node.isMesh ? '·' : ''}</span>
              )}

              <span className="tree-label">
                {labelFor(node)}
                {showPath && node.parentId && <span className="tree-path"> — in {graph.byId.get(node.parentId)?.name}</span>}
                <span className="tree-raw">{node.name || node.rawType}</span>
              </span>

              <span className="tree-badges">
                {isEdited && <i className="badge-dot" title="Changed from the original" />}
                {optionCount > 0 && <span className="badge-count" title={`${optionCount} finish options available`}>{optionCount}</span>}
              </span>
            </div>
          );
        })}
      </div>

      <div className="tree-footer">
        {graph.stats.nodeCount} nodes · {graph.stats.meshCount} meshes · {graph.stats.materialCount} materials ·{' '}
        {graph.stats.textureCount} textures
      </div>
    </div>
  );
}
