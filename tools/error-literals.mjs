import vm from 'node:vm';

// This is a bounded source check for authored string literals, not a JavaScript
// parser. Preserve offsets and strings while excluding line/block comments.
export function withoutComments(source){
  return source.replace(/('(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`)|(\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/g,(text,literal)=>literal||text.replace(/[^\r\n]/g,' '));
}

export function errorLiterals(source){
  const code=withoutComments(source),out=[];
  const quoted=[...code.matchAll(/'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`/g)].map(match=>[match.index,match.index+match[0].length]);
  const expression=/\b(?:throw\s+(?:new\s+)?Error\s*\(\s*|(?:new\s+)?ReviewSessionError\s*\(\s*|error\s*:\s*)('(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*")/g;
  for(const match of code.matchAll(expression)){
    if(quoted.some(([start,end])=>match.index>=start&&match.index<end))continue;
    // Only a complete, lexically bounded quoted literal is evaluated. No file
    // code or dynamic expression is executed in this isolated context.
    const value=vm.runInNewContext(match[1],Object.create(null),{timeout:100});
    const concatenated=/^\s*\+/.test(code.slice(match.index+match[0].length));
    out.push({value,concatenated,line:source.slice(0,match.index).split('\n').length});
  }
  return out;
}
