figma.showUI(__html__, { width: 360, height: 680 });

let searchScope = figma.currentPage.selection.slice();
let traversalSelection = searchScope.slice();
let expectedPluginSelection = null;
let preservedPluginSelection = [];
let preserveSelectionOnBlur = false;
let layerNameTraversalActive = false;
let layerNameTraversalKeyword = '';
let layerNameTraversalMatchMode = 'contains';
let fontSizeReference = createDefaultStyleReference();
let styleMode = 'font-size';
let searchScopeTextCount = 0;

function createDefaultStyleReference() {
  return {
    textName: '기본',
    fontKey: null,
    font: null,
    fontSize: 16,
    colorKey: JSON.stringify([0, 0, 0, 1]),
    color: {
      hex: '#000000',
      opacity: 1,
      css: 'rgba(0, 0, 0, 1)'
    }
  };
}

function updateFontSizeReference(selection) {
  if (selection.length !== 1 || selection[0].type !== 'TEXT') return;

  const textNode = selection[0];
  const font = getUniformTextFont(textNode);
  const color = getUniformTextColor(textNode);
  fontSizeReference = {
    textName: textNode.name,
    fontKey: font ? font.key : null,
    font,
    fontSize: typeof textNode.fontSize === 'number' && Number.isFinite(textNode.fontSize)
      ? textNode.fontSize
      : null,
    colorKey: color ? color.key : null,
    color
  };
  styleMode = 'font-size';
}

updateFontSizeReference(searchScope);
searchScopeTextCount = findScopeTextNodes(searchScope).length;

function sameSelection(first, second) {
  if (first.length !== second.length) return false;
  const secondIds = new Set(second.map(node => node.id));
  return first.every(node => secondIds.has(node.id));
}

function setPluginSelection(nodes) {
  const nextSelection = Array.from(new Map(nodes.map(node => [node.id, node])).values());
  expectedPluginSelection = nextSelection;
  preservedPluginSelection = nextSelection.slice();
  preserveSelectionOnBlur = false;
  traversalSelection = nextSelection.slice();
  figma.currentPage.selection = nextSelection;
  postSelectionInfo();
}

function findScopeNodes(scope) {
  const nodes = [];
  const seen = new Set();
  const pending = scope.slice().reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    nodes.push(node);
    if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index--) {
        pending.push(node.children[index]);
      }
    }
  }
  return nodes;
}

function findScopeTextNodes(scope) {
  const textNodes = [];
  const seen = new Set();
  const pending = scope.slice().reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    if (node.type === 'TEXT') {
      textNodes.push(node);
    } else if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index--) {
        pending.push(node.children[index]);
      }
    }
  }
  return textNodes;
}

function getUniformTextColor(node) {
  if (!Array.isArray(node.fills)) return null;
  const visibleFills = node.fills.filter(paint => paint.visible !== false);
  if (visibleFills.length !== 1 || visibleFills[0].type !== 'SOLID') return null;

  const paint = visibleFills[0];
  const color = paint.color;
  if (!color || ![color.r, color.g, color.b].every(Number.isFinite)) return null;
  const opacity = paint.opacity === undefined ? 1 : paint.opacity;
  const key = JSON.stringify([
    color.r,
    color.g,
    color.b,
    opacity
  ].map(value => Math.round(value * 100000) / 100000));
  const channels = [color.r, color.g, color.b].map(value =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
  );
  const hex = '#' + channels.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  return {
    key,
    hex,
    opacity,
    css: `rgba(${channels.join(', ')}, ${opacity})`
  };
}

function getUniformTextFont(node) {
  const font = node.fontName;
  if (!font || (typeof figma.mixed !== 'undefined' && font === figma.mixed)) return null;
  if (typeof font.family !== 'string' || typeof font.style !== 'string') return null;
  return {
    key: JSON.stringify([font.family, font.style]),
    family: font.family,
    style: font.style,
    label: `${font.family} ${font.style}`
  };
}

function isMatchingNodeType(node, targetType) {
  if (!targetType || targetType === 'ANY') return true;
  if (targetType === 'AUTO_LAYOUT') {
    return node.type === 'FRAME' && node.layoutMode !== 'NONE';
  }
  if (targetType === 'FRAME') {
    return node.type === 'FRAME' && node.layoutMode === 'NONE';
  }
  if (targetType === 'GROUP') return node.type === 'GROUP';
  if (targetType === 'COMPONENT') {
    return node.type === 'COMPONENT' || node.type === 'INSTANCE';
  }
  return targetType === 'TEXT' && node.type === 'TEXT';
}

function findDirectNodesByName(scope, keyword, exactMatch = false, targetType = 'ANY') {
  const normalizedKeyword = keyword.toLowerCase();
  return getDirectChildren(scope).filter(node => {
    if (!isMatchingNodeType(node, targetType)) return false;
    const name = exactMatch ? node.name : node.name.toLowerCase();
    return exactMatch ? node.name === keyword : name.includes(normalizedKeyword);
  });
}

function replaceScopeNode(previousNode, nextNode) {
  searchScope = searchScope.map(node => node.id === previousNode.id ? nextNode : node);
}

function getStructureType(node) {
  if (node.type === 'GROUP') return 'GROUP';
  if (node.type === 'FRAME') return node.layoutMode === 'NONE' ? 'FRAME' : 'AUTO_LAYOUT';
  return null;
}

function hasAutoLayoutParent(node) {
  return node.parent && node.parent.type === 'FRAME' && node.parent.layoutMode !== 'NONE';
}

function convertGroupToFrame(group) {
  const parent = group.parent;
  if (!parent || !('insertChild' in parent)) {
    throw new Error('그룹의 부모 영역에 프레임을 추가할 수 없습니다.');
  }
  if (hasAutoLayoutParent(group)) {
    throw new Error('오토레이아웃 내부 그룹은 먼저 부모 오토레이아웃에서 분리해야 합니다.');
  }

  const index = parent.children.indexOf(group);
  const frame = figma.createFrame();
  frame.name = group.name;
  frame.resize(group.width, group.height);
  frame.x = group.x;
  frame.y = group.y;
  frame.rotation = group.rotation;
  frame.opacity = group.opacity;
  frame.visible = group.visible;
  frame.fills = [];
  frame.clipsContent = false;
  parent.insertChild(index, frame);

  for (const child of [...group.children]) {
    frame.appendChild(child);
  }
  group.remove();
  replaceScopeNode(group, frame);
  return frame;
}

function convertFrameToGroup(frame) {
  const parent = frame.parent;
  if (!parent || !('insertChild' in parent)) {
    throw new Error('프레임의 부모 영역에서 그룹으로 변경할 수 없습니다.');
  }
  if (hasAutoLayoutParent(frame)) {
    throw new Error('오토레이아웃 내부 프레임은 먼저 부모 오토레이아웃에서 분리해야 합니다.');
  }
  if (frame.rotation !== 0) {
    throw new Error('회전된 프레임은 위치 보존을 위해 그룹으로 변경할 수 없습니다.');
  }
  if (frame.children.length === 0) {
    throw new Error('내용이 없는 프레임은 그룹으로 변경할 수 없습니다.');
  }

  const index = parent.children.indexOf(frame);
  const children = [...frame.children];
  const childPositions = children.map(child => ({
    x: child.x + frame.x,
    y: child.y + frame.y
  }));
  for (let childIndex = 0; childIndex < children.length; childIndex++) {
    parent.insertChild(index + childIndex, children[childIndex]);
    children[childIndex].x = childPositions[childIndex].x;
    children[childIndex].y = childPositions[childIndex].y;
  }

  const name = frame.name;
  const opacity = frame.opacity;
  frame.remove();
  const group = figma.group(children, parent, index);
  group.name = name;
  group.opacity = opacity;
  replaceScopeNode(frame, group);
  return group;
}

function convertStructureType(node, targetType, layoutMode) {
  const sourceType = getStructureType(node);
  if (!sourceType) throw new Error('그룹, 프레임 또는 오토레이아웃만 변경할 수 있습니다.');

  let convertedNode = node;
  if (sourceType === targetType) {
    if (targetType === 'AUTO_LAYOUT' && node.layoutMode !== layoutMode) {
      node.layoutMode = layoutMode;
      return node;
    }
    return null;
  }

  if (sourceType === 'GROUP') {
    convertedNode = convertGroupToFrame(node);
  }

  if (targetType === 'GROUP') {
    if (sourceType === 'AUTO_LAYOUT') {
      if (!node.parent || !('insertChild' in node.parent) ||
          hasAutoLayoutParent(node) || node.rotation !== 0 || node.children.length === 0) {
        throw new Error('현재 오토레이아웃은 그룹으로 변경할 수 없습니다.');
      }
      node.layoutMode = 'NONE';
    }
    convertedNode = convertFrameToGroup(convertedNode);
  } else {
    convertedNode.layoutMode = targetType === 'AUTO_LAYOUT' ? layoutMode : 'NONE';
  }

  return convertedNode;
}

function getNodeDepth(node) {
  let depth = 0;
  for (let parent = node.parent; parent; parent = parent.parent) depth++;
  return depth;
}

function wrapNodeInStructure(node, targetType, layoutMode = 'VERTICAL') {
  const parent = node.parent;
  if (!parent || !('insertChild' in parent)) {
    throw new Error('선택한 레이어를 감쌀 수 있는 부모가 없습니다.');
  }

  const index = parent.children.indexOf(node);
  if (index < 0) throw new Error('선택한 레이어의 위치를 확인할 수 없습니다.');
  const name = node.name;

  if (targetType === 'GROUP') {
    const group = figma.group([node], parent, index);
    group.name = name;
    replaceScopeNode(node, group);
    return group;
  }

  const frame = figma.createFrame();
  frame.name = name;
  frame.resize(node.width, node.height);
  frame.x = node.x;
  frame.y = node.y;
  frame.fills = [];
  frame.clipsContent = false;

  const parentUsesAutoLayout = parent.type === 'FRAME' && parent.layoutMode !== 'NONE';
  if (parentUsesAutoLayout) {
    ['layoutSizingHorizontal', 'layoutSizingVertical', 'layoutAlign', 'layoutGrow']
      .forEach(property => {
        if (property in node && property in frame) frame[property] = node[property];
      });
  }

  parent.insertChild(index, frame);
  frame.appendChild(node);
  node.x = 0;
  node.y = 0;

  if (targetType === 'AUTO_LAYOUT') {
    frame.layoutMode = layoutMode;
    frame.primaryAxisSizingMode = 'FIXED';
    frame.counterAxisSizingMode = 'FIXED';
    frame.paddingTop = 0;
    frame.paddingRight = 0;
    frame.paddingBottom = 0;
    frame.paddingLeft = 0;
    frame.itemSpacing = 0;
  }

  const wrapper = targetType === 'COMPONENT'
    ? figma.createComponentFromNode(frame)
    : frame;
  replaceScopeNode(node, wrapper);
  return wrapper;
}

function postSelectionInfo() {
  const selection = figma.currentPage.selection;

  figma.ui.postMessage({
    type: 'selection-info',
    selectionCount: selection.length,
    scopeCount: searchScope.length,
    scopeNames: searchScope.map(node => node.name),
    scopeTextCount: searchScopeTextCount,
    fontSizeReference,
    styleMode
  });
}

function resetFeatureState() {
  fontSizeReference = createDefaultStyleReference();
  styleMode = 'font-size';
  postSelectionInfo();
  resetFeatureInputs();
}

function resetFeatureInputs() {
  figma.ui.postMessage({ type: 'reset-feature-inputs' });
}

function updateSearchScopeFromCurrentSelection() {
  searchScope = figma.currentPage.selection.slice();
  traversalSelection = searchScope.slice();
  searchScopeTextCount = findScopeTextNodes(searchScope).length;
  expectedPluginSelection = null;
  layerNameTraversalActive = false;
  layerNameTraversalKeyword = '';
  layerNameTraversalMatchMode = 'contains';
  updateFontSizeReference(searchScope);
}

function handleSelectionChange() {
  const selection = figma.currentPage.selection;
  if (preserveSelectionOnBlur && selection.length === 0) {
    const validSelection = preservedPluginSelection.filter(node => !node.removed);
    if (validSelection.length > 0) {
      expectedPluginSelection = validSelection;
      figma.currentPage.selection = validSelection;
      preserveSelectionOnBlur = false;
      postSelectionInfo();
      return;
    }
  }
  preserveSelectionOnBlur = false;
  if (expectedPluginSelection && sameSelection(selection, expectedPluginSelection)) {
    expectedPluginSelection = null;
  } else {
    searchScope = selection.slice();
    traversalSelection = searchScope.slice();
    searchScopeTextCount = findScopeTextNodes(searchScope).length;
    expectedPluginSelection = null;
    preservedPluginSelection = [];
    layerNameTraversalActive = false;
    layerNameTraversalKeyword = '';
    layerNameTraversalMatchMode = 'contains';
    updateFontSizeReference(selection);
  }
  postSelectionInfo();
}

figma.on('selectionchange', handleSelectionChange);
figma.on('currentpagechange', () => {
  updateSearchScopeFromCurrentSelection();
  postSelectionInfo();
});

function getDirectChildren(selection) {
  const children = [];
  const seen = new Set();
  for (const node of selection) {
    if ('children' in node) {
      for (const child of node.children) {
        if (!seen.has(child.id)) {
          seen.add(child.id);
          children.push(child);
        }
      }
    }
  }
  return children;
}

function selectDuplicateNames(selection) {
  const matchingNodes = [];
  const nodesByName = new Map();
  for (const node of getDirectChildren(selection)) {
    const sameNameNodes = nodesByName.get(node.name) || [];
    sameNameNodes.push(node);
    nodesByName.set(node.name, sameNameNodes);
  }
  for (const nodes of nodesByName.values()) {
    if (nodes.length > 1) matchingNodes.push(...nodes);
  }
  return matchingNodes;
}

function selectNodesAtNextDepth(selection, targetType) {
  return getDirectChildren(selection)
    .filter(node => isMatchingNodeType(node, targetType));
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'ui-ready') {
    updateSearchScopeFromCurrentSelection();
    postSelectionInfo();
    return;
  }

  if (msg.type === 'ui-blur') {
    preserveSelectionOnBlur = preservedPluginSelection.length > 0;
    return;
  }

  if (msg.type === 'select-same-font') {
    styleMode = 'font';
    postSelectionInfo();
    if (!fontSizeReference || !fontSizeReference.fontKey) {
      figma.notify('기준 텍스트의 서체가 하나로 설정된 텍스트를 먼저 선택해 주세요.');
      return;
    }
    const matchingNodes = findScopeTextNodes(searchScope).filter(node => {
      const font = getUniformTextFont(node);
      return font && font.key === fontSizeReference.fontKey;
    });
    if (matchingNodes.length === 0) {
      figma.notify('같은 서체의 텍스트가 없습니다.');
      return;
    }
    setPluginSelection(matchingNodes);
    figma.notify(matchingNodes.length + '개의 같은 서체 텍스트가 선택되었습니다.');
    return;
  }

  if (msg.type === 'select-same-font-size-and-color') {
    styleMode = 'font-size-color';
    postSelectionInfo();
    if (!fontSizeReference) {
      figma.notify('기준이 될 텍스트 하나를 먼저 선택해주세요.');
      return;
    }
    if (typeof fontSizeReference.fontSize !== 'number' || !Number.isFinite(fontSizeReference.fontSize)) {
      figma.notify('기준 텍스트의 글자 크기가 여러 값으로 설정되어 있습니다.');
      return;
    }
    if (!fontSizeReference.fontKey) {
      figma.notify('기준 텍스트의 서체가 하나로 설정된 텍스트를 먼저 선택해 주세요.');
      return;
    }
    if (!fontSizeReference.colorKey) {
      figma.notify('기준 텍스트에 단일 단색 채우기를 설정해주세요.');
      return;
    }
    const matchingNodes = findScopeTextNodes(searchScope).filter(node => {
      if (node.fontSize !== fontSizeReference.fontSize) return false;
      const font = getUniformTextFont(node);
      if (!font || font.key !== fontSizeReference.fontKey) return false;
      const color = getUniformTextColor(node);
      return color && color.key === fontSizeReference.colorKey;
    });
    if (matchingNodes.length === 0) {
      figma.notify('서체·크기·색상이 모두 같은 텍스트가 없습니다.');
      return;
    }
    setPluginSelection(matchingNodes);
    figma.notify(matchingNodes.length + '개의 같은 서체·크기·색상 텍스트가 선택되었습니다.');
    return;
  }

  if (msg.type === 'select-same-font-size' || msg.type === 'select-same-text-color') {
    let matchingNodes;
    if (msg.type === 'select-same-font-size') {
      styleMode = 'font-size';
      postSelectionInfo();
      if (!fontSizeReference) {
        figma.notify('기준이 될 텍스트 하나를 먼저 선택해주세요.');
        return;
      }
      if (typeof fontSizeReference.fontSize !== 'number') {
        figma.notify('기준 텍스트의 글자 크기가 여러 값으로 설정되어 있습니다.');
        return;
      }
      matchingNodes = findScopeTextNodes(searchScope)
        .filter(node => node.fontSize === fontSizeReference.fontSize);
    } else {
      styleMode = 'color';
      postSelectionInfo();
      if (!fontSizeReference) {
        figma.notify('색상 기준이 될 텍스트 하나를 먼저 선택해주세요.');
        return;
      }
      if (!fontSizeReference.colorKey) {
        figma.notify('기준 텍스트에 단일 단색 채우기를 설정해주세요.');
        return;
      }
      matchingNodes = findScopeTextNodes(searchScope)
        .filter(node => {
          const color = getUniformTextColor(node);
          return color && color.key === fontSizeReference.colorKey;
        });
    }

    if (matchingNodes.length === 0) {
      figma.notify('기준 스타일과 일치하는 텍스트가 없습니다.');
      return;
    }

    setPluginSelection(matchingNodes);
    figma.notify(matchingNodes.length + '개의 같은 스타일 텍스트가 선택되었습니다.');
    return;
  }

  const selection = searchScope;

  if (selection.length === 0) {
    figma.notify('먼저 그룹이나 레이어를 선택해주세요.');
    return;
  }

  // 1. 모든 텍스트 선택
  if (msg.type === 'select-all-text') {
    const allTextNodes = findScopeTextNodes(selection);

    if (allTextNodes.length === 0) {
      figma.notify('선택한 영역 내에 텍스트 레이어가 없습니다.');
      return;
    }

    setPluginSelection(allTextNodes);
    figma.notify(allTextNodes.length + '개의 텍스트 레이어가 선택되었습니다.');
  }

  // 2-1. 텍스트 일치 선택
  else if (msg.type === 'select-exact-text') {
    const keyword = typeof msg.keyword === 'string' ? msg.keyword.trim() : '';
    if (!keyword) {
      figma.notify('검색할 텍스트를 입력해주세요.');
      return;
    }

    const allTextNodes = findScopeTextNodes(selection);

    const matchedNodes = allTextNodes.filter(node => node.characters.trim() === keyword);
    if (matchedNodes.length === 0) {
      figma.notify('내용과 일치하는 텍스트가 없습니다.');
      return;
    }

    setPluginSelection(matchedNodes);
    figma.notify(matchedNodes.length + '개의 텍스트 레이어가 선택되었습니다.');
  }

  // 2-2. 텍스트 포함 선택
  else if (msg.type === 'select-keyword') {
    const keyword = typeof msg.keyword === 'string' ? msg.keyword.trim() : '';
    if (!keyword) {
      figma.notify('검색할 키워드를 입력해주세요.');
      return;
    }

    const allTextNodes = findScopeTextNodes(selection);

    const matchedNodes = allTextNodes.filter(node => 
      node.characters.toLowerCase().includes(keyword.toLowerCase())
    );
    if (matchedNodes.length === 0) {
      figma.notify('키워드가 포함된 텍스트가 없습니다.');
      return;
    }

    setPluginSelection(matchedNodes);
    figma.notify(matchedNodes.length + '개의 텍스트 레이어가 선택되었습니다.');
  }

  // 2-3. 텍스트 내용 변경
  else if (msg.type === 'replace-text') {
    const target = typeof msg.target === 'string' ? msg.target.trim() : '';
    const replacement = typeof msg.replacement === 'string' ? msg.replacement : '';
    const targetScope = msg.targetScope === 'selected' ? 'selected' : 'all';

    if (!target) {
      figma.notify('찾을 텍스트를 입력해주세요.');
      return;
    }
    if (!replacement.trim()) {
      figma.notify('변경할 텍스트를 입력해주세요.');
      return;
    }

    const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const targetPattern = new RegExp(escapedTarget, 'i');
    const replacementPattern = new RegExp(escapedTarget, 'gi');
    const searchTextNodes = targetScope === 'selected'
      ? figma.currentPage.selection.filter(node => node.type === 'TEXT')
      : findScopeTextNodes(selection);
    const targetNodes = searchTextNodes
      .filter(node => targetPattern.test(node.characters));
    if (targetNodes.length === 0) {
      figma.notify(targetScope === 'selected'
        ? '현재 선택한 텍스트 레이어에서 문구를 찾지 못했습니다.'
        : '검색 범위에서 문구를 포함한 텍스트가 없습니다.');
      return;
    }

    let updateCount = 0;
    let failedCount = 0;
    for (const node of targetNodes) {
      try {
        const fonts = node.getRangeAllFontNames(0, node.characters.length);
        for (const font of fonts) {
          await figma.loadFontAsync(font);
        }
        node.characters = node.characters.replace(replacementPattern, () => replacement);
        updateCount++;
      } catch (err) {
        failedCount++;
        console.error('텍스트 변경 실패:', err);
      }
    }

    figma.notify(
      failedCount === 0
        ? updateCount + '개의 텍스트 내용이 변경되었습니다.'
        : updateCount + '개 변경, ' + failedCount + '개는 폰트 로드 또는 내용 변경에 실패했습니다.'
    );
    if (updateCount > 0) resetFeatureState();
  }

  // 3-1. 레이어 이름 일치 선택
  else if (msg.type === 'select-exact-layer-name') {
    const keyword = typeof msg.layerName === 'string' ? msg.layerName.trim() : '';
    if (!keyword) {
      figma.notify('레이어 이름을 입력해주세요.');
      return;
    }

    const targetType = typeof msg.targetType === 'string' ? msg.targetType : 'ANY';
    if (!['ANY', 'AUTO_LAYOUT', 'FRAME', 'GROUP', 'COMPONENT', 'TEXT'].includes(targetType)) {
      figma.notify('검색할 유형을 확인해주세요.');
      return;
    }

    const searchBasis = layerNameTraversalActive &&
      keyword === layerNameTraversalKeyword &&
      layerNameTraversalMatchMode === 'exact'
      ? traversalSelection
      : selection;
    const matchedNodes = findDirectNodesByName(searchBasis, keyword, true, targetType);
    if (matchedNodes.length === 0) {
      figma.notify('이름과 일치하는 레이어가 없습니다.');
      return;
    }

    layerNameTraversalActive = true;
    layerNameTraversalKeyword = keyword;
    layerNameTraversalMatchMode = 'exact';
    setPluginSelection(matchedNodes);
    figma.notify(matchedNodes.length + '개의 레이어가 선택되었습니다.');
  }

  // 3-2. 레이어 이름 포함 선택
  else if (msg.type === 'select-include-layer-name') {
    const keyword = typeof msg.layerName === 'string' ? msg.layerName.trim() : '';
    if (!keyword) {
      figma.notify('검색할 이름을 입력해주세요.');
      return;
    }

    const targetType = typeof msg.targetType === 'string' ? msg.targetType : 'ANY';
    if (!['ANY', 'AUTO_LAYOUT', 'FRAME', 'GROUP', 'COMPONENT', 'TEXT'].includes(targetType)) {
      figma.notify('검색할 유형을 확인해주세요.');
      return;
    }

    const searchBasis = layerNameTraversalActive &&
      keyword === layerNameTraversalKeyword &&
      layerNameTraversalMatchMode === 'contains'
      ? traversalSelection
      : selection;
    const matchedNodes = findDirectNodesByName(searchBasis, keyword, false, targetType);
    if (matchedNodes.length === 0) {
      figma.notify('문구가 포함된 레이어가 없습니다.');
      return;
    }

    layerNameTraversalActive = true;
    layerNameTraversalKeyword = keyword;
    layerNameTraversalMatchMode = 'contains';
    setPluginSelection(matchedNodes);
    figma.notify(matchedNodes.length + '개의 레이어가 선택되었습니다.');
  }

  // 3-3. 입력한 문구로 레이어 이름 변경
  else if (msg.type === 'replace-layer-name') {
    const replacement = typeof msg.replacement === 'string' ? msg.replacement.trim() : '';
    const targetScope = msg.targetScope === 'all' ? 'all' : 'selected';

    if (!replacement) {
      figma.notify('새 레이어 이름을 입력해주세요.');
      return;
    }

    let selectedNodes;
    if (targetScope === 'all') {
      const target = typeof msg.target === 'string' ? msg.target.trim() : '';
      if (!target) {
        figma.notify('검색 범위 전체를 변경하려면 찾을 레이어 이름을 입력해주세요.');
        return;
      }

      const exactMatch = msg.matchMode === 'exact';
      selectedNodes = findDirectNodesByName(searchScope, target, exactMatch);
    } else {
      selectedNodes = figma.currentPage.selection;
    }

    if (selectedNodes.length === 0) {
      figma.notify(targetScope === 'all'
        ? '검색 범위에서 조건에 맞는 레이어가 없습니다.'
        : '이름을 바꿀 레이어를 먼저 검색해 선택해주세요.');
      return;
    }

    let updatedCount = 0;
    let failedCount = 0;
    for (const node of selectedNodes) {
      try {
        node.name = replacement;
        updatedCount++;
      } catch (error) {
        failedCount++;
        console.error('레이어 이름 변경 실패:', error);
      }
    }

    figma.notify(
      failedCount === 0
        ? updatedCount + '개의 레이어 이름이 변경되었습니다.'
        : updatedCount + '개 변경, ' + failedCount + '개는 이름 변경에 실패했습니다.'
    );
    if (updatedCount > 0) resetFeatureState();
  }

  else if (msg.type === 'convert-structure-type') {
    const sourceType = typeof msg.sourceType === 'string' ? msg.sourceType : '';
    const targetType = typeof msg.targetType === 'string' ? msg.targetType : '';
    const layoutMode = msg.layoutMode === 'HORIZONTAL' ? 'HORIZONTAL' : 'VERTICAL';
    if (!['GROUP', 'FRAME', 'AUTO_LAYOUT'].includes(sourceType) ||
        !['GROUP', 'FRAME', 'AUTO_LAYOUT'].includes(targetType)) {
      figma.notify('변경할 구조 유형을 확인해주세요.');
      return;
    }

    const candidates = findScopeNodes(traversalSelection).filter(node =>
      isMatchingNodeType(node, sourceType) && getStructureType(node)
    );
    if (candidates.length === 0) {
      figma.notify('선택된 영역에서 변경할 구조를 찾지 못했습니다.');
      return;
    }

    const convertedNodes = [];
    const conversionErrors = [];
    let failedCount = 0;
    for (const node of candidates) {
      try {
        const convertedNode = convertStructureType(node, targetType, layoutMode);
        if (convertedNode) convertedNodes.push(convertedNode);
      } catch (error) {
        failedCount++;
        conversionErrors.push(error instanceof Error ? error.message : String(error));
        console.error('구조 유형 변경 실패:', error);
      }
    }

    if (convertedNodes.length > 0) {
      setPluginSelection(convertedNodes);
    }
    if (convertedNodes.length === 0 && failedCount === 0) {
      figma.notify('선택한 구조가 이미 해당 유형입니다.');
      return;
    }
    figma.notify(
      failedCount === 0
        ? convertedNodes.length + '개의 구조 유형이 변경되었습니다.'
        : convertedNodes.length + '개 변경, ' + failedCount + '개 실패: ' + conversionErrors[0]
    );
    if (convertedNodes.length > 0) resetFeatureState();
  }

  else if (msg.type === 'group-selected-layers') {
    const targetType = typeof msg.targetType === 'string' ? msg.targetType : '';
    if (!['AUTO_LAYOUT', 'FRAME', 'GROUP', 'COMPONENT'].includes(targetType)) {
      figma.notify('그룹화할 구조 유형을 확인해주세요.');
      return;
    }
    const layoutMode = msg.layoutMode === 'HORIZONTAL' ? 'HORIZONTAL' : 'VERTICAL';
    if (targetType === 'AUTO_LAYOUT' &&
        msg.layoutMode !== 'HORIZONTAL' && msg.layoutMode !== 'VERTICAL') {
      figma.notify('오토레이아웃 방향을 선택해주세요.');
      return;
    }

    const selectedNodes = Array.from(
      new Map(figma.currentPage.selection.map(node => [node.id, node])).values()
    );
    if (selectedNodes.length === 0) {
      figma.notify('그룹화할 레이어를 먼저 선택해주세요.');
      return;
    }

    selectedNodes.sort((first, second) => {
      const depthDifference = getNodeDepth(first) - getNodeDepth(second);
      if (depthDifference !== 0) return depthDifference;
      if (first.parent !== second.parent) return 0;
      return second.parent.children.indexOf(second) - first.parent.children.indexOf(first);
    });

    const wrappedNodes = [];
    const failedNodes = [];
    const errors = [];
    for (const node of selectedNodes) {
      try {
        wrappedNodes.push(wrapNodeInStructure(node, targetType, layoutMode));
      } catch (error) {
        failedNodes.push(node);
        errors.push(error instanceof Error ? error.message : String(error));
        console.error('레이어 그룹화 실패:', error);
      }
    }

    if (wrappedNodes.length > 0) {
      setPluginSelection(wrappedNodes.concat(failedNodes));
    }
    if (wrappedNodes.length === 0) {
      figma.notify(errors[0] || '선택한 레이어를 그룹화하지 못했습니다.');
      return;
    }

    const typeLabels = {
      AUTO_LAYOUT: '오토레이아웃',
      FRAME: '프레임',
      GROUP: '그룹',
      COMPONENT: '컴포넌트'
    };
    figma.notify(
      failedNodes.length === 0
        ? wrappedNodes.length + '개의 레이어를 각각 ' + typeLabels[targetType] + '으로 묶었습니다.'
        : wrappedNodes.length + '개 그룹화, ' + failedNodes.length + '개 실패: ' + errors[0]
    );
    resetFeatureState();
  }

  // 4-1. 레이어 전체 선택
  else if (msg.type === 'select-same-name-all') {
    const matchingNodes = selectDuplicateNames(traversalSelection);
    if (matchingNodes.length === 0) {
      figma.notify('동일한 이름을 가진 레이어가 없습니다.');
      return;
    }
    setPluginSelection(matchingNodes);
    figma.notify(matchingNodes.length + '개의 레이어가 선택되었습니다.');
  }

  // 유형별 버튼은 선택한 레이어 바로 아래 단계에서 탐색합니다.
  else if (
    msg.type === 'select-type-autolayout' ||
    msg.type === 'select-type-frame' ||
    msg.type === 'select-type-group' ||
    msg.type === 'select-type-component' ||
    msg.type === 'select-type-text'
  ) {
    const actions = {
      'select-type-autolayout': { targetType: 'AUTO_LAYOUT', label: '오토레이아웃', noMatch: '현재 단계에 선택할 오토레이아웃이 없습니다.' },
      'select-type-frame': { targetType: 'FRAME', label: '프레임', noMatch: '현재 단계에 선택할 프레임이 없습니다.' },
      'select-type-group': { targetType: 'GROUP', label: '그룹', noMatch: '현재 단계에 선택할 그룹이 없습니다.' },
      'select-type-component': { targetType: 'COMPONENT', label: '컴포넌트', noMatch: '현재 단계에 선택할 컴포넌트가 없습니다.' },
      'select-type-text': { targetType: 'TEXT', label: '텍스트 레이어', noMatch: '현재 단계에 선택할 텍스트가 없습니다.' }
    };
    const action = actions[msg.type];
    let matchingNodes;
    if (msg.layerNameSearch === true) {
      const keyword = typeof msg.layerName === 'string' ? msg.layerName.trim() : '';
      if (!keyword) {
        figma.notify('레이어 이름 키워드를 입력해주세요.');
        return;
      }

      const matchMode = msg.matchMode === 'exact' ? 'exact' : 'contains';
      const isCurrentNameSearch = layerNameTraversalActive &&
        keyword === layerNameTraversalKeyword &&
        matchMode === layerNameTraversalMatchMode;
      if (isCurrentNameSearch) {
        matchingNodes = selectNodesAtNextDepth(traversalSelection, action.targetType);
      } else {
        matchingNodes = findDirectNodesByName(
          searchScope,
          keyword,
          matchMode === 'exact',
          action.targetType
        );
      }
    } else {
      matchingNodes = selectNodesAtNextDepth(traversalSelection, action.targetType);
    }

    if (matchingNodes.length === 0) {
      figma.notify(action.noMatch);
      return;
    }

    if (msg.layerNameSearch === true) {
      layerNameTraversalActive = true;
      layerNameTraversalKeyword = typeof msg.layerName === 'string' ? msg.layerName.trim() : '';
      layerNameTraversalMatchMode = msg.matchMode === 'exact' ? 'exact' : 'contains';
    }
    setPluginSelection(matchingNodes);
    figma.notify(matchingNodes.length + '개의 ' + action.label + '이 선택되었습니다.');
  }
};
