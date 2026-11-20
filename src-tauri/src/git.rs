//! Aba Git: status do repositório do `cwd` da sessão, diff de um arquivo e as
//! escritas pedidas pela UI (commit, restore, stash/pop, push).
//!
//! O git roda sem shell (`std::process::Command`, nunca `sh -c`) e com timeout
//! manual de 10 s (std não tem `wait_timeout`; nenhuma dependência nova). O
//! status é um JSON fechado; o diff é o patch unificado cru; as escritas
//! devolvem o texto do git e falham com o stderr literal.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Component, Path};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(10);

/// Uma mudança do `status --porcelain=v2`, já com o numstat casado por path.
#[derive(Debug, Clone, PartialEq)]
pub struct Change {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub untracked: bool,
    pub add: Option<u64>,
    pub del: Option<u64>,
}

/// Status com o repositório do `cwd` informado pela UI.
#[tauri::command(async)]
pub fn git_status(cwd: String) -> Result<String, String> {
    if !Path::new(&cwd).is_dir() {
        return Ok(no_repo());
    }
    let args = [
        "-c",
        "core.quotepath=false",
        "status",
        "--porcelain=v2",
        "--branch",
        "--untracked-files=all",
        "--renames",
    ];
    let Some(status_out) = run_git(&cwd, &args)? else {
        return Ok(no_repo()); // exit != 0: fora de um repo git
    };
    // Repo sem commit (HEAD inexistente) faz o diff sair != 0: sem números.
    let numstat_out = run_git(
        &cwd,
        &["-c", "core.quotepath=false", "diff", "HEAD", "--numstat"],
    )
    .ok()
    .flatten();
    Ok(status_payload(&status_out, numstat_out.as_deref()))
}

/// Teto do diff mandado ao webview: arquivo untracked de vários MB virava um
/// único `setMarkdown` gigante (trava de render) e o mesmo tanto de IPC.
const MAX_DIFF_BYTES: usize = 256 * 1024;

fn cap_diff(mut patch: String) -> String {
    if patch.len() <= MAX_DIFF_BYTES {
        return patch;
    }
    let mut cut = MAX_DIFF_BYTES;
    while cut > 0 && !patch.is_char_boundary(cut) {
        cut -= 1;
    }
    patch.truncate(cut);
    patch.push_str("\n\n… diff truncado (arquivo grande)");
    patch
}

/// Patch unificado de UM arquivo do `cwd`: `HEAD` (worktree + índice), depois só
/// o índice (`--cached`) e por fim `--no-index` contra o device nulo, que é o
/// caminho do untracked. Texto cru; sem diff, string vazia.
#[tauri::command(async)]
pub fn git_file_diff(cwd: String, path: String) -> Result<String, String> {
    validate_diff_path(&path)?;
    if !Path::new(&cwd).is_dir() {
        return Err(format!("cwd não é um diretório: {cwd}"));
    }
    let head = run_git(
        &cwd,
        &["-c", "core.quotepath=false", "diff", "HEAD", "--no-color", "--", &path],
    )?;
    if let Some(patch) = head.filter(|p| !p.trim().is_empty()) {
        return Ok(cap_diff(patch));
    }
    let cached = run_git(
        &cwd,
        &["-c", "core.quotepath=false", "diff", "--cached", "--no-color", "--", &path],
    )?;
    if let Some(patch) = cached.filter(|p| !p.trim().is_empty()) {
        return Ok(cap_diff(patch));
    }
    // `--no-index` sai != 0 quando há diferença (o caso normal): o stdout vale
    // mesmo assim, por isso `run_git_raw` em vez de `run_git`.
    let (_, patch) = run_git_raw(
        &cwd,
        &["-c", "core.quotepath=false", "diff", "--no-index", "--no-color", "/dev/null", &path],
    )?;
    Ok(cap_diff(patch))
}

/// `path` vem do webview e vira argumento do git: só caminho relativo, sem `..`
/// e sem começar com `-`. Puro — não toca no disco.
fn validate_diff_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("path vazio".to_string());
    }
    if path.starts_with('-') {
        return Err(format!("path inválido (começa com '-'): {path}"));
    }
    if Path::new(path).is_absolute() {
        return Err(format!("path inválido (absoluto): {path}"));
    }
    for comp in Path::new(path).components() {
        match comp {
            Component::ParentDir => {
                return Err(format!("path inválido (contém '..'): {path}"));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("path inválido (absoluto): {path}"));
            }
            _ => {}
        }
    }
    Ok(())
}

/// JSON do shape fechado que a UI consome — puro, para testar sem fs.
fn status_payload(status_out: &str, numstat_out: Option<&str>) -> String {
    let (branch, ahead, behind, detached, mut changes) = parse_porcelain_v2(status_out);
    let numstat = numstat_out.map(parse_numstat).unwrap_or_default();
    for c in changes.iter_mut() {
        if let Some((add, del)) = numstat.get(&c.path) {
            c.add = *add;
            c.del = *del;
        }
    }

    let files = changes.len();
    let add: u64 = changes.iter().filter_map(|c| c.add).sum();
    let del: u64 = changes.iter().filter_map(|c| c.del).sum();
    let payload = serde_json::json!({
        "repo": true,
        "branch": branch,
        "ahead": ahead,
        "behind": behind,
        "detached": detached,
        "changes": changes
            .iter()
            .map(|c| serde_json::json!({
                "path": c.path,
                "status": c.status,
                "staged": c.staged,
                "untracked": c.untracked,
                "add": c.add,
                "del": c.del,
            }))
            .collect::<Vec<_>>(),
        "totals": { "files": files, "add": add, "del": del },
    });
    payload.to_string()
}

fn no_repo() -> String {
    "{\"repo\":false}".to_string()
}

/// Roda git sem shell. `Ok(None)` = rodou e saiu != 0 (ex.: repo sem HEAD);
/// `Err` = não conseguiu rodar ou estourou o timeout.
pub(crate) fn run_git(cwd: &str, args: &[&str]) -> Result<Option<String>, String> {
    let (ok, out) = run_git_raw(cwd, args)?;
    Ok(if ok { Some(out) } else { None })
}

/// Igual a `run_git`, mas devolve o stdout com exit != 0 (`diff --no-index` sai 1
/// quando as duas entradas diferem) e `Err` só quando não rodou ou estourou.
fn run_git_raw(cwd: &str, args: &[&str]) -> Result<(bool, String), String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("git: {e}"))?;

    // Sem `wait_timeout` no std: drena o stdout em outra thread e faz polling no
    // pai; se estourar, mata o processo (o pipe fecha e a leitura termina).
    let mut stdout = child.stdout.take().ok_or("git: stdout indisponível")?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        String::from_utf8_lossy(&buf).into_owned()
    });

    let deadline = Instant::now() + TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let out = reader.join().unwrap_or_default();
    match status {
        Some(st) => Ok((st.success(), out)),
        None => Err("git: timeout de 10s".to_string()),
    }
}

/// Roda git de escrita: stdout E stderr capturados, exit code real. Mesmo timeout
/// e mesmo "sem shell" do `run_git_raw`. `Err` só quando não rodou ou estourou;
/// exit != 0 volta em `Ok` para o chamador expor o texto do git.
fn run_git_rw(cwd: &str, args: &[&str]) -> Result<(i32, String, String), String> {
    let mut child = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("git: {e}"))?;

    // Os dois pipes são drenados em threads próprias: se um enchesse o buffer
    // enquanto o pai espera, o git travaria até o timeout.
    let mut stdout = child.stdout.take().ok_or("git: stdout indisponível")?;
    let mut stderr = child.stderr.take().ok_or("git: stderr indisponível")?;
    let out_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        String::from_utf8_lossy(&buf).into_owned()
    });
    let err_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        String::from_utf8_lossy(&buf).into_owned()
    });

    let deadline = Instant::now() + TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let out = out_reader.join().unwrap_or_default();
    let err = err_reader.join().unwrap_or_default();
    match status {
        Some(st) => Ok((st.code().unwrap_or(-1), out, err)),
        None => Err("git: timeout de 10s".to_string()),
    }
}

/// Texto de erro de uma falha do git: o stderr literal (é o que o usuário lê);
/// stdout só quando o git saiu != 0 sem escrever nada no stderr.
fn git_fail(err: String, out: String) -> String {
    if err.trim().is_empty() {
        out.trim().to_string()
    } else {
        err
    }
}

/// `run_git_rw` exigindo exit 0: falha vira `Err` com o texto do git.
fn git_rw_ok(cwd: &str, args: &[&str]) -> Result<String, String> {
    let (code, out, err) = run_git_rw(cwd, args)?;
    if code == 0 {
        Ok(out)
    } else {
        Err(git_fail(err, out))
    }
}

/// Os comandos de escrita vêm do webview: exigem um diretório de verdade antes
/// de qualquer git (senão o erro seria "git: No such file or directory").
fn require_dir(cwd: &str) -> Result<String, String> {
    if !Path::new(cwd).is_dir() {
        return Err(format!("cwd não é um diretório: {cwd}"));
    }
    Ok(cwd.to_string())
}

/// `git add` dos `paths` (vazio = nada a estágiar) e commit com a mensagem.
/// `amend` troca a mensagem do último commit, por isso `--amend -m <message>`
/// (e NÃO `--no-edit`, que manteria a mensagem antiga). Devolve o hash curto do
/// HEAD novo; qualquer falha volta com o texto literal do git.
#[tauri::command(async)]
pub fn git_commit(
    cwd: String,
    message: String,
    paths: Vec<String>,
    amend: bool,
) -> Result<String, String> {
    let cwd = require_dir(&cwd)?;
    if message.trim().is_empty() {
        return Err("mensagem vazia".to_string());
    }
    for p in &paths {
        validate_diff_path(p)?;
    }
    if !paths.is_empty() {
        let mut args = vec!["add", "--"];
        args.extend(paths.iter().map(String::as_str));
        git_rw_ok(&cwd, &args)?;
    }
    let mut args = vec!["commit"];
    if amend {
        args.push("--amend");
    }
    args.push("-m");
    args.push(message.as_str());
    git_rw_ok(&cwd, &args)?;
    let (code, out, err) = run_git_rw(&cwd, &["rev-parse", "--short", "HEAD"])?;
    if code != 0 {
        return Err(git_fail(err, out));
    }
    Ok(out.trim().to_string())
}

/// `git restore -- <paths>`: desfaz o worktree pelo índice. Untracked é recusado
/// com erro explícito — o equivalente seria `git clean`, que apaga arquivo sem
/// volta e está fora do escopo da aba.
#[tauri::command(async)]
pub fn git_discard(cwd: String, paths: Vec<String>) -> Result<String, String> {
    let cwd = require_dir(&cwd)?;
    if paths.is_empty() {
        return Err("nenhum path selecionado".to_string());
    }
    for p in &paths {
        validate_diff_path(p)?;
    }
    for p in &paths {
        // `--error-unmatch` sai != 0 e escreve no stderr para path fora do índice.
        let (code, _, _) = run_git_rw(&cwd, &["ls-files", "--error-unmatch", "--", p])?;
        if code != 0 {
            return Err(format!(
                "{p}: não rastreado pelo git — descartar só vale para arquivo rastreado"
            ));
        }
    }
    let mut args = vec!["restore", "--"];
    args.extend(paths.iter().map(String::as_str));
    git_rw_ok(&cwd, &args)
}

/// Stash com untracked incluso e mensagem carimbada (`sightdeck: <epoch>`), para o
/// usuário reconhecer de onde veio a entrada na lista de stashes.
#[tauri::command(async)]
pub fn git_stash(cwd: String) -> Result<String, String> {
    let cwd = require_dir(&cwd)?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let msg = format!("sightdeck: {stamp}");
    git_rw_ok(
        &cwd,
        &["stash", "push", "--include-untracked", "-m", msg.as_str()],
    )
}

/// `git stash pop`: conflito sai != 0 com a lista de arquivos em conflito — vira
/// `Err` para a UI mostrar em vez de fingir sucesso.
#[tauri::command(async)]
pub fn git_stash_pop(cwd: String) -> Result<String, String> {
    let cwd = require_dir(&cwd)?;
    git_rw_ok(&cwd, &["stash", "pop"])
}

/// Só fast-forward: sem `--ff-only` o pull criaria um merge commit que ninguém
/// pediu (e que o push depois recusaria).
#[tauri::command(async)]
pub fn git_pull(cwd: String) -> Result<String, String> {
    let cwd = require_dir(&cwd)?;
    git_rw_ok(&cwd, &["pull", "--ff-only"])
}

/// `git push` (ou `--force-with-lease`, nunca `--force`). O git escreve o
/// progresso e o erro no stderr: sucesso devolve esse texto, falha devolve `Err`
/// com o stderr literal — non-fast-forward e "sem remote" ficam legíveis.
#[tauri::command(async)]
pub fn git_push(cwd: String, force_with_lease: bool) -> Result<String, String> {
    let cwd = require_dir(&cwd)?;
    let args: &[&str] = if force_with_lease {
        &["push", "--force-with-lease"]
    } else {
        &["push"]
    };
    let (code, out, err) = run_git_rw(&cwd, args)?;
    if code != 0 {
        return Err(git_fail(err, out));
    }
    Ok(if out.trim().is_empty() {
        err.trim().to_string()
    } else {
        out.trim().to_string()
    })
}

/// Decide o status exibido: 1 letra do XY, preferindo o índice quando há algo staged.
fn status_letter(xy: &str) -> String {
    let b = xy.as_bytes();
    let pick = match b.first() {
        Some(c) if *c != b'.' => *c,
        _ => match b.get(1) {
            Some(c) if *c != b'.' => *c,
            _ => b'.',
        },
    };
    (pick as char).to_string()
}

fn change_from_xy(xy: &str, path: &str) -> Change {
    let x = xy.as_bytes().first().copied().unwrap_or(b'.');
    Change {
        path: path.to_string(),
        status: status_letter(xy),
        staged: x != b'.',
        untracked: false,
        add: None,
        del: None,
    }
}

/// `(branch, ahead, behind, detached, mudanças)`. Aceita o cabeçalho v2
/// (`# branch.head` / `# branch.ab`) e o v1 (`## main...origin/main [ahead 2, behind 1]`).
fn parse_porcelain_v2(out: &str) -> (String, u32, u32, bool, Vec<Change>) {
    let mut branch = String::new();
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut detached = false;
    let mut changes = Vec::new();

    for line in out.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("## ") {
            parse_v1_branch(rest, &mut branch, &mut ahead, &mut behind, &mut detached);
        } else if let Some(rest) = line.strip_prefix("# branch.head ") {
            if rest.trim() == "(detached)" {
                detached = true;
                branch.clear();
            } else {
                branch = rest.trim().to_string();
            }
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for tok in rest.split_whitespace() {
                if let Some(n) = tok.strip_prefix('+') {
                    ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = tok.strip_prefix('-') {
                    behind = n.parse().unwrap_or(0);
                }
            }
        } else if let Some(rest) = line.strip_prefix("? ") {
            changes.push(Change {
                path: rest.to_string(),
                status: "?".to_string(),
                staged: false,
                untracked: true,
                add: None,
                del: None,
            });
        } else if let Some(rest) = line.strip_prefix("1 ") {
            // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
            let f: Vec<&str> = rest.splitn(8, ' ').collect();
            if f.len() == 8 {
                changes.push(change_from_xy(f[0], f[7]));
            }
        } else if let Some(rest) = line.strip_prefix("2 ") {
            // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<orig>
            let f: Vec<&str> = rest.splitn(9, ' ').collect();
            if f.len() == 9 {
                let path = f[8].split('\t').next().unwrap_or(f[8]);
                changes.push(change_from_xy(f[0], path));
            }
        } else if let Some(rest) = line.strip_prefix("u ") {
            // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
            let f: Vec<&str> = rest.splitn(10, ' ').collect();
            if f.len() == 10 {
                changes.push(change_from_xy(f[0], f[9]));
            }
        }
        // `!` (ignorado) fica fora: o shape só carrega mudança real.
    }
    (branch, ahead, behind, detached, changes)
}

fn parse_v1_branch(
    rest: &str,
    branch: &mut String,
    ahead: &mut u32,
    behind: &mut u32,
    detached: &mut bool,
) {
    let rest = rest.trim();
    if rest.contains("(no branch)") {
        *detached = true;
        branch.clear();
        return;
    }
    let head = rest.split(" [").next().unwrap_or(rest);
    let head = head.split("...").next().unwrap_or(head).trim();
    *branch = match head.strip_prefix("No commits yet on ") {
        Some(n) => n.trim().to_string(),
        None => head.to_string(),
    };
    if let Some(start) = rest.find('[') {
        let inner = rest[start + 1..].split(']').next().unwrap_or("");
        for tok in inner.split(',') {
            let tok = tok.trim();
            if let Some(n) = tok.strip_prefix("ahead ") {
                *ahead = n.trim().parse().unwrap_or(0);
            } else if let Some(n) = tok.strip_prefix("behind ") {
                *behind = n.trim().parse().unwrap_or(0);
            }
        }
    }
}

/// `path -> (add, del)`; binário (`-`) vira `None` dos dois lados.
fn parse_numstat(out: &str) -> HashMap<String, (Option<u64>, Option<u64>)> {
    let mut map = HashMap::new();
    for line in out.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let mut f = line.splitn(3, '\t');
        let add = f.next().and_then(|n| n.trim().parse::<u64>().ok());
        let del = f.next().and_then(|n| n.trim().parse::<u64>().ok());
        let Some(raw) = f.next() else { continue };
        map.insert(numstat_key(raw), (add, del));
    }
    map
}

/// Path do numstat -> path do porcelain. Rename aparece como `old => new`,
/// `dir/{a => b}.rs` ou `dir/{a => }.rs`; o porcelain usa só o destino.
fn numstat_key(raw: &str) -> String {
    let p = raw.trim();
    let p = match p.strip_prefix('"').and_then(|q| q.strip_suffix('"')) {
        Some(q) => q,
        None => p,
    };
    let Some(idx) = p.find(" => ") else {
        return p.to_string();
    };
    let (prefix, suffix) = (&p[..idx], &p[idx + 4..]);
    match (prefix.rfind('{'), suffix.find('}')) {
        (Some(open), Some(close)) => {
            format!("{}{}{}", &prefix[..open], &suffix[..close], &suffix[close + 1..])
        }
        _ => suffix.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn porcelain_v2_le_branch_ab_e_as_mudancas() {
        let out = "\
# branch.oid 0123456789abcdef
# branch.head main
# branch.upstream origin/main
# branch.ab +2 -1
1 M. N... 100644 100644 100644 aaaa bbbb src/staged.rs
1 .M N... 100644 100644 100644 aaaa bbbb src/worktree.rs
1 MM N... 100644 100644 100644 aaaa bbbb src/both.rs
? untracked.txt
2 R. N... 100644 100644 100644 aaaa bbbb R100 new name.rs\told name.rs
";
        let (branch, ahead, behind, detached, changes) = parse_porcelain_v2(out);
        assert_eq!(branch, "main");
        assert_eq!((ahead, behind), (2, 1));
        assert!(!detached);
        assert_eq!(changes.len(), 5);

        assert_eq!(changes[0].path, "src/staged.rs");
        assert_eq!(changes[0].status, "M");
        assert!(changes[0].staged);
        assert!(!changes[0].untracked);

        assert_eq!(changes[1].path, "src/worktree.rs");
        assert_eq!(changes[1].status, "M");
        assert!(!changes[1].staged);

        assert_eq!(changes[2].status, "M");
        assert!(changes[2].staged);

        assert_eq!(changes[3].path, "untracked.txt");
        assert_eq!(changes[3].status, "?");
        assert!(changes[3].untracked);
        assert!(!changes[3].staged);

        assert_eq!(changes[4].path, "new name.rs"); // só o destino, sem `\told`
        assert_eq!(changes[4].status, "R");
        assert!(changes[4].staged);
    }

    #[test]
    fn porcelain_v1_header_le_ahead_e_behind() {
        let (branch, ahead, behind, detached, changes) =
            parse_porcelain_v2("## main...origin/main [ahead 2, behind 1]\n");
        assert_eq!(branch, "main");
        assert_eq!((ahead, behind), (2, 1));
        assert!(!detached);
        assert!(changes.is_empty());
    }

    #[test]
    fn porcelain_detached_nas_duas_formas() {
        let (branch, _, _, detached, _) = parse_porcelain_v2("## HEAD (no branch)\n");
        assert!(detached);
        assert_eq!(branch, "");

        let (branch, _, _, detached, _) = parse_porcelain_v2("# branch.head (detached)\n");
        assert!(detached);
        assert_eq!(branch, "");
    }

    #[test]
    fn numstat_casa_numeros_binario_e_path_com_espaco() {
        let map = parse_numstat("3\t1\tsrc/a.rs\n-\t-\timg.png\n7\t0\tdocs/com espaco.md\n");
        assert_eq!(map.get("src/a.rs"), Some(&(Some(3), Some(1))));
        assert_eq!(map.get("img.png"), Some(&(None, None)));
        assert_eq!(map.get("docs/com espaco.md"), Some(&(Some(7), Some(0))));
    }

    #[test]
    fn numstat_normaliza_renomeado_para_o_path_do_porcelain() {
        let map = parse_numstat("1\t2\tsrc/{old => new}.rs\n4\t5\tantigo.rs => novo.rs\n");
        assert_eq!(map.get("src/new.rs"), Some(&(Some(1), Some(2))));
        assert_eq!(map.get("novo.rs"), Some(&(Some(4), Some(5))));
    }

    #[test]
    fn validate_diff_path_aceita_caminho_relativo() {
        for ok in ["STATE.md", "src/main.rs", "ui/src/main.js", "dir com espaço/a.txt"] {
            assert!(validate_diff_path(ok).is_ok(), "{ok} deveria passar");
        }
    }

    #[test]
    fn validate_diff_path_recusa_absoluto() {
        for bad in ["/etc/passwd", "/home/user/x.txt"] {
            let err = validate_diff_path(bad).unwrap_err();
            assert!(err.contains("absoluto"), "{bad}: {err}");
        }
    }

    #[test]
    fn validate_diff_path_recusa_parent_dir() {
        for bad in ["..", "../x", "a/../../b", "dir/.."] {
            let err = validate_diff_path(bad).unwrap_err();
            assert!(err.contains(".."), "{bad}: {err}");
        }
    }

    #[test]
    fn validate_diff_path_recusa_flag_e_vazio() {
        // Mesmo depois de `--` o git vem em outra posição: nada de `-` na frente.
        for bad in ["-x", "--no-index", "-e"] {
            let err = validate_diff_path(bad).unwrap_err();
            assert!(err.contains("começa com '-'"), "{bad}: {err}");
        }
        assert!(validate_diff_path("   ").unwrap_err().contains("vazio"));
    }

    #[test]
    fn status_payload_tem_exatamente_o_shape_da_ui() {
        let out = "# branch.head main\n\
# branch.ab +0 -0\n\
1 M. N... 100644 100644 100644 a b x.rs\n\
1 .M N... 100644 100644 100644 a b y.rs\n\
? novo.txt\n";
        let payload = status_payload(out, Some("3\t1\tx.rs\n9\t2\ty.rs\n"));
        let v: serde_json::Value = serde_json::from_str(&payload).expect("json válido");
        let keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, ["ahead", "behind", "branch", "changes", "detached", "repo", "totals"]);
        assert_eq!(v["repo"], true);
        assert_eq!(v["branch"], "main");
        assert_eq!(v["changes"][0]["add"], 3);
        assert_eq!(v["changes"][0]["del"], 1);
        assert_eq!(v["changes"][1]["add"], 9);
        // untracked não tem linha no numstat: segue null
        assert_eq!(v["changes"][2]["untracked"], true);
        assert!(v["changes"][2]["add"].is_null());
        assert_eq!(v["totals"]["files"], 3);
        assert_eq!(v["totals"]["add"], 12);
        assert_eq!(v["totals"]["del"], 3);
        assert_eq!(no_repo(), "{\"repo\":false}");
    }

    /// Roda um git de preparação (init/config/log) sem depender do config do
    /// usuário. O commit em si é feito pelos comandos, que usam o config LOCAL do
    /// repo — por isso a identidade é gravada no repo, não passada por `-c`.
    fn git_setup(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .stdin(Stdio::null())
            .output()
            .expect("git precisa estar no PATH para este teste");
        assert!(out.status.success(), "git {args:?} falhou: {out:?}");
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    /// Repo descartável com identidade e sem assinatura de commit (o config global
    /// do usuário pode ter `commit.gpgsign` e derrubar o teste sem motivo).
    fn temp_repo(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("sightdeck-rw-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git_setup(&dir, &["init", "-q"]);
        for (k, v) in [
            ("user.name", "sightdeck teste"),
            ("user.email", "teste@sightdeck.local"),
            ("commit.gpgsign", "false"),
            // Git for Windows vem com `core.autocrlf=true`: o checkout gravaria
            // CRLF e os testes que comparam "um\n" quebram só no CI do Windows.
            ("core.autocrlf", "false"),
        ] {
            git_setup(&dir, &["config", k, v]);
        }
        dir
    }

    #[test]
    fn git_commit_cria_commit_e_devolve_hash_curto() {
        let dir = temp_repo("commit");
        std::fs::write(dir.join("a.txt"), "um\n").unwrap();
        let cwd = dir.to_string_lossy().into_owned();

        let hash = git_commit(cwd, "primeiro".to_string(), vec!["a.txt".to_string()], false).unwrap();
        let log = git_setup(&dir, &["log", "--oneline", "-1"]);
        let _ = std::fs::remove_dir_all(&dir);

        assert!(hash.len() >= 7 && hash.len() <= 12, "hash curto: {hash:?}");
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()), "hex: {hash:?}");
        assert!(
            log.starts_with(hash.as_str()) && log.contains("primeiro"),
            "log {log:?} não casa com o hash {hash:?}"
        );
    }

    #[test]
    fn git_commit_recusa_mensagem_vazia() {
        let dir = temp_repo("msgvazia");
        std::fs::write(dir.join("a.txt"), "um\n").unwrap();
        let cwd = dir.to_string_lossy().into_owned();

        let err = git_commit(cwd, "   \n  ".to_string(), vec!["a.txt".to_string()], false).unwrap_err();
        let status = git_setup(&dir, &["status", "--porcelain", "--untracked-files=all"]);
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(err, "mensagem vazia");
        assert!(status.contains("? a.txt"), "nada deveria ter sido estágiado: {status:?}");
    }

    #[test]
    fn git_commit_recusa_path_com_parent_dir() {
        let dir = temp_repo("pathpai");
        std::fs::write(dir.join("a.txt"), "um\n").unwrap();
        let cwd = dir.to_string_lossy().into_owned();

        let err = git_commit(cwd, "msg".to_string(), vec!["../fora.txt".to_string()], false).unwrap_err();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(err.contains(".."), "{err}");
    }

    #[test]
    fn git_discard_restaura_arquivo_rastreado() {
        let dir = temp_repo("discard");
        std::fs::write(dir.join("a.txt"), "um\n").unwrap();
        let cwd = dir.to_string_lossy().into_owned();
        git_commit(cwd.clone(), "base".to_string(), vec!["a.txt".to_string()], false).unwrap();
        std::fs::write(dir.join("a.txt"), "dois\n").unwrap();

        git_discard(cwd, vec!["a.txt".to_string()]).unwrap();
        let restored = std::fs::read_to_string(dir.join("a.txt")).unwrap();
        let status = git_setup(&dir, &["status", "--porcelain"]);
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(restored, "um\n");
        assert_eq!(status.trim(), "", "worktree deveria ficar limpo: {status:?}");
    }

    #[test]
    fn git_discard_recusa_untracked_sem_apagar() {
        let dir = temp_repo("untracked");
        std::fs::write(dir.join("novo.txt"), "x\n").unwrap();
        let cwd = dir.to_string_lossy().into_owned();

        let err = git_discard(cwd, vec!["novo.txt".to_string()]).unwrap_err();
        let kept = dir.join("novo.txt").exists();
        let _ = std::fs::remove_dir_all(&dir);

        assert!(err.contains("não rastreado"), "{err}");
        assert!(kept, "descartar não pode apagar untracked (seria `git clean`)");
    }

    #[test]
    fn git_stash_com_untracked_e_pop_devolve_o_worktree() {
        let dir = temp_repo("stash");
        std::fs::write(dir.join("a.txt"), "um\n").unwrap();
        let cwd = dir.to_string_lossy().into_owned();
        git_commit(cwd.clone(), "base".to_string(), vec!["a.txt".to_string()], false).unwrap();
        std::fs::write(dir.join("a.txt"), "dois\n").unwrap();
        std::fs::write(dir.join("novo.txt"), "x\n").unwrap();

        let stashed = git_stash(cwd.clone()).unwrap();
        let after_stash = git_setup(&dir, &["status", "--porcelain", "--untracked-files=all"]);
        let hidden = !dir.join("novo.txt").exists()
            && std::fs::read_to_string(dir.join("a.txt")).unwrap() == "um\n";

        let popped = git_stash_pop(cwd).unwrap();
        let restored = std::fs::read_to_string(dir.join("a.txt")).unwrap();
        let untracked_back = dir.join("novo.txt").exists();
        let _ = std::fs::remove_dir_all(&dir);

        assert!(stashed.contains("sightdeck: "), "mensagem carimbada: {stashed:?}");
        assert!(after_stash.trim().is_empty(), "worktree deveria ficar limpo: {after_stash:?}");
        assert!(hidden, "`--include-untracked` leva o untracked junto");
        assert!(!popped.trim().is_empty(), "pop sem saída: {popped:?}");
        assert_eq!(restored, "dois\n");
        assert!(untracked_back, "pop devolve o untracked");
    }

    #[test]
    fn git_push_sem_remote_devolve_erro_do_git() {
        let dir = temp_repo("push");
        std::fs::write(dir.join("a.txt"), "um\n").unwrap();
        let cwd = dir.to_string_lossy().into_owned();
        git_commit(cwd.clone(), "base".to_string(), vec!["a.txt".to_string()], false).unwrap();

        let err = git_push(cwd, false).unwrap_err();
        let _ = std::fs::remove_dir_all(&dir);

        // Sem remote o git sai 128: o texto do git vai para a UI, sem panic.
        assert!(!err.trim().is_empty(), "erro vazio");
        assert!(err.contains("push"), "stderr do git esperado: {err:?}");
    }

    /// Prova ponta a ponta do comando em repo git de verdade (não só o parser).
    /// Se falhar aqui, o problema não é o `cwd` que a UI manda.
    #[test]
    fn git_status_le_repo_real_com_untracked() {
        let dir = std::env::temp_dir().join(format!("sightdeck-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ok = Command::new("git")
            .args(["init", "-q"])
            .current_dir(&dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("git precisa estar no PATH para este teste")
            .success();
        assert!(ok, "git init falhou");
        std::fs::write(dir.join("novo.txt"), "x\n").unwrap();

        let out = git_status(dir.to_string_lossy().into_owned()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(v["repo"], serde_json::json!(true), "{out}");
        assert!(
            v["changes"].as_array().unwrap().iter().any(|c| c["path"] == "novo.txt"),
            "untracked ausente no payload: {out}"
        );
    }
}

