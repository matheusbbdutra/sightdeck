//! Navegação read-only da pasta do projeto: lista os arquivos e entrega o
//! conteúdo de um deles ao visualizador. Nada aqui escreve no disco.
//!
//! A lista vem do git (`ls-files`) para herdar o `.gitignore` de graça; fora de
//! um repositório, um walk raso com ignore-list fixa evita `node_modules`.

use std::io::Read;
use std::path::Path;

use crate::git::run_git;
use crate::sessions::contained_in;

/// Teto do texto devolvido ao webview: acima disso o viewer marca `truncated`.
const MAX_TEXT_BYTES: usize = 256 * 1024;
/// Profundidade do fallback sem git (3 níveis bastam para navegar).
const WALK_DEPTH: usize = 3;
/// Diretórios que nunca entram na lista do fallback (o git já os ignora).
const SKIP_DIRS: [&str; 8] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".svelte-kit",
    ".venv",
    "__pycache__",
];

/// Planos/notas do projeto em JSON (`["plans/x.md", …]`), ordenados.
/// Só markdown: a aba existe para ler plano, não para navegar código.
/// `git ls-files --cached --others --exclude-standard` cobre rastreados +
/// não rastreados não ignorados; `None` (sem repo) cai no walk.
#[tauri::command(async)]
pub fn project_files(cwd: String) -> Result<String, String> {
    let files = project_files_in(Path::new(&cwd))?;
    Ok(serde_json::to_string(&files).unwrap_or_else(|_| "[]".to_string()))
}

/// A aba serve para ler plano/nota: só markdown entra na lista (o viewer
/// renderiza como markdown, não como código).
const MD_EXT: [&str; 3] = ["md", "mdx", "markdown"];

fn is_markdown(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| MD_EXT.contains(&e.to_ascii_lowercase().as_str()))
}

fn project_files_in(cwd: &Path) -> Result<Vec<String>, String> {
    if !cwd.is_dir() {
        return Err(format!("pasta indisponível: {}", cwd.display()));
    }

    if let Some(out) = run_git(
        &cwd.to_string_lossy(),
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
    )? {
        let mut files: Vec<String> = out
            .split('\0')
            .filter(|s| !s.is_empty() && is_markdown(s))
            .map(str::to_string)
            .collect();
        files.sort_unstable();
        files.dedup();
        return Ok(files);
    }

    let mut files = Vec::new();
    walk(cwd, cwd, 0, &mut files);
    files.sort_unstable();
    Ok(files)
}

fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            if depth + 1 > WALK_DEPTH || SKIP_DIRS.contains(&name) {
                continue;
            }
            walk(root, &path, depth + 1, out);
            continue;
        }
        if let Ok(rel) = path.strip_prefix(root) {
            let rel = rel.to_string_lossy().replace('\\', "/");
            if is_markdown(&rel) {
                out.push(rel);
            }
        }
    }
}

/// Conteúdo de um arquivo do projeto em JSON:
/// `{text, bytes, truncated, binary}`. `path` relativo é resolvido a partir do
/// `cwd` da sessão (mesmo precedente de `open_file`); `../` é recusado por
/// `contained_in`. Binário (NUL nos primeiros 8 KB) devolve `binary: true` sem
/// texto, para o viewer não renderizar lixo.
#[tauri::command(async)]
pub fn read_text_file(cwd: String, path: String) -> Result<String, String> {
    read_text_in(Path::new(&cwd), Path::new(&path))
}

fn read_text_in(cwd: &Path, path: &Path) -> Result<String, String> {
    let target = contained_in(&cwd.join(path), cwd)?;
    if !target.is_file() {
        return Err(format!("não é arquivo: {}", path.display()));
    }
    let meta = std::fs::metadata(&target).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut buf = Vec::with_capacity(meta.len().min(MAX_TEXT_BYTES as u64) as usize);
    let read = std::fs::File::open(&target)
        .and_then(|f| f.take(MAX_TEXT_BYTES as u64).read_to_end(&mut buf))
        .map_err(|e| format!("ler {}: {e}", path.display()))?;

    let binary = buf.iter().take(8192).any(|b| *b == 0);
    let truncated = (read as u64) < meta.len();
    let text = if binary {
        String::new()
    } else {
        String::from_utf8_lossy(&buf).into_owned()
    };

    Ok(serde_json::json!({
        "text": text,
        "bytes": meta.len(),
        "truncated": truncated,
        "binary": binary,
    })
    .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Pasta temporária única por teste (sem depender de git no host).
    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sightdeck-files-{}-{}-{}",
            std::process::id(),
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn read_json(dir: &Path, rel: &str) -> serde_json::Value {
        serde_json::from_str(&read_text_in(dir, Path::new(rel)).unwrap()).unwrap()
    }

    #[test]
    fn le_texto_e_marca_truncado_e_binario() {
        let dir = temp_dir("read");

        std::fs::write(dir.join("a.txt"), "linha 1\nlinha 2\n").unwrap();
        let v = read_json(&dir, "a.txt");
        assert_eq!(v["text"], "linha 1\nlinha 2\n");
        assert_eq!(v["bytes"], 16);
        assert_eq!(v["truncated"], false);
        assert_eq!(v["binary"], false);

        std::fs::write(dir.join("big.txt"), "x".repeat(MAX_TEXT_BYTES + 10)).unwrap();
        let v = read_json(&dir, "big.txt");
        assert_eq!(v["truncated"], true);
        assert_eq!(v["text"].as_str().unwrap().len(), MAX_TEXT_BYTES);

        std::fs::write(dir.join("bin"), [0u8, 1, 2, 3]).unwrap();
        let v = read_json(&dir, "bin");
        assert_eq!(v["binary"], true);
        assert_eq!(v["text"], "");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn recusa_caminho_fora_do_projeto() {
        let dir = temp_dir("escape");
        // O alvo precisa EXISTIR para o `canonicalize` de `contained_in` resolvê-lo
        // antes de comparar prefixos: um caminho inexistente morre com NotFound
        // (no Windows `../../etc/passwd` cai em `AppData\Local\etc\passwd`).
        let fora = dir.with_file_name(format!(
            "{}-fora",
            dir.file_name().unwrap().to_string_lossy()
        ));
        std::fs::create_dir_all(&fora).unwrap();
        std::fs::write(fora.join("segredo.txt"), "x").unwrap();
        let rel = format!(
            "../{}/segredo.txt",
            fora.file_name().unwrap().to_string_lossy()
        );

        let err = read_text_in(&dir, Path::new(&rel)).unwrap_err();
        assert!(err.contains("fora do diretório"), "{err}");

        std::fs::remove_dir_all(&fora).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn walk_lista_so_markdown_e_pula_node_modules() {
        let dir = temp_dir("walk");
        std::fs::write(dir.join("a.md"), "a").unwrap();
        std::fs::write(dir.join("a.txt"), "a").unwrap();
        std::fs::create_dir_all(dir.join("sub/deep")).unwrap();
        std::fs::write(dir.join("sub/b.MD"), "b").unwrap();
        std::fs::create_dir_all(dir.join("node_modules/x")).unwrap();
        std::fs::write(dir.join("node_modules/x/c.md"), "c").unwrap();
        std::fs::create_dir_all(dir.join(".hidden")).unwrap();
        std::fs::write(dir.join(".hidden/d.md"), "d").unwrap();

        // `project_files_in` com git indisponível cai no walk. Se /tmp estiver
        // dentro de um repo, o git responderia — o filtro de markdown vale nos dois.
        let files = project_files_in(&dir).unwrap();
        assert!(files.contains(&"a.md".to_string()), "{files:?}");
        assert!(files.contains(&"sub/b.MD".to_string()), "{files:?}");
        assert!(!files.iter().any(|f| f.ends_with(".txt")), "{files:?}");
        assert!(
            !files
                .iter()
                .any(|f| f.contains("node_modules") || f.contains(".hidden")),
            "{files:?}"
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
