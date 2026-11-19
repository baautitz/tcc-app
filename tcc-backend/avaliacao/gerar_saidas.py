"""Gera quadros LaTeX e gráficos a partir de resultados-oficiais/consolidado.json e l_dashboard_r_payload.json.

Uso: python3 avaliacao/gerar_saidas.py <pasta-do-modelo-latex>
"""
import json, sys, csv
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

AQUI = Path(__file__).parent / "resultados-oficiais"
MODELO = Path(sys.argv[1])
TAB = MODELO / "Tabelas"
IMG = MODELO / "Imagens" / "resultados"
TAB.mkdir(exist_ok=True, parents=True)
IMG.mkdir(exist_ok=True, parents=True)
c = json.load(open(AQUI / "consolidado.json"))
ld = json.load(open(AQUI / "l_dashboard_r_payload.json"))

NOMES = {"kpi": "KPIs isolados", "temporal": "Agrupamentos temporais", "juncoes": "Junções múltiplas", "lista": "Listas tabulares"}
CORES = ["#2a78d6", "#eb6834", "#1baf7a"]


def pt(x, d=1):
    return f"{x:.{d}f}".replace(".", ",")


def pct(m):
    if not m:
        return "--"
    return f"{pt(m['media'])} $\\pm$ {pt(m['dp'])}"


def quadro(nome, legenda, label, colspec, cab, linhas, nota=None, fonte="Elaborado pelo autor (2026)."):
    """Emite uma Tabela (dados numericos, IBGE/NBR 14724): booktabs, sem linhas verticais, Fonte antes de Nota."""
    colspec = colspec.replace("|", "")
    label = label.replace("qua:", "tab:")
    nome = nome.replace("quadro_", "tabela_")
    linhas_tex = []
    for l in linhas:
        if str(l[0]).startswith("\\textbf{Geral}") or str(l[0]).startswith("\\textbf{Total}"):
            linhas_tex.append("\t\t\\midrule")
        linhas_tex.append("\t\t" + " & ".join(str(x) for x in l) + " \\\\")
    corpo = "\n".join(linhas_tex)
    nota_tex = f"\n\t\\par\\vspace{{2pt}}\n\t\\small Nota: {nota}\\par" if nota else ""
    (TAB / f"{nome}.tex").write_text(
        "% Gerado por tcc-backend/avaliacao/gerar_saidas.py (nao editar a mao)\n"
        "\\begin{table}[H]\n\t\\centering\n"
        f"\t\\caption{{{legenda}}}\n\t\\label{{{label}}}\n"
        "\t\\small\n"
        f"\t\\begin{{tabular}}{{{colspec}}}\n\t\t\\toprule\n\t\t" + " & ".join(f"\\textbf{{{x}}}" for x in cab)
        + " \\\\\n\t\t\\midrule\n" + corpo + "\n\t\t\\bottomrule\n\t\\end{tabular}"
        + f"\n\t\\fonte{{{fonte}}}" + nota_tex + "\n\\end{table}\n")


def lin_grupo(rotulo, g):
    return [rotulo, g["n"], pct(g["EX"]), pct(g["tipo"]), pct(g["C_sintatica"]), f"{g['sch_true']}/{g['sch_validos']}"]


cab1 = ["Grupo", "Execuções", "EX (\\%)", "Tipo correto (\\%)", "$C_{\\text{sintática}}$ (\\%)", "Esquema válido na 1ª tentativa"]
def C(w):
    return ">{\\centering\\arraybackslash}p{%s}" % w


spec1 = "|p{2.8cm}|" + "|".join([C("2.0cm"), C("1.9cm"), C("2.0cm"), C("2.2cm"), C("2.2cm")]) + "|"
nota1 = "Média $\\pm$ desvio padrão entre as três repetições; cada repetição percorre o conjunto inteiro."
linhas = [lin_grupo(NOMES[k], c["por_cenario"][k]) for k in ("kpi", "temporal", "juncoes", "lista")]
linhas.append(lin_grupo("\\textbf{Geral}", c["geral"]))
quadro("quadro_resultados_cenarios", "Resultados do agente por cenário analítico", "qua:res-cenarios", spec1, cab1, linhas, nota1)

linhas = []
for k, rot in (("easy", "Fácil"), ("medium", "Médio"), ("hard", "Difícil"), ("extra", "Extra")):
    if k in c["por_lei"]:
        linhas.append(lin_grupo(f"Lei et al.: {rot}", c["por_lei"][k]))
for k, rot in (("easy", "Fácil"), ("medium", "Médio"), ("hard", "Difícil"), ("extra", "Extra difícil")):
    if k in c["por_spider"]:
        linhas.append(lin_grupo(f"Spider: {rot}", c["por_spider"][k]))
quadro("quadro_resultados_dificuldade", "Resultados do agente por nível de dificuldade do SQL de referência", "qua:res-dificuldade", spec1, cab1, linhas, nota1)

# tempos
T = c["tempos_gold"]
def lt(rot, k, esc=1.0, d=1):
    m = T[k]
    return [rot, pt(m["media"] / esc, d), pt(m["dp"] / esc, d), pt(m["min"] / esc, d), pt(m["max"] / esc, d)]
def tem(k):
    # Métricas que o provedor não informa (ex.: texto do raciocínio na Responses API) ficam fora da tabela.
    return T.get(k) is not None and T[k]["max"] > 0
linhas = [lt("$L_{\\text{agente}}$ (s)", "L_total_ms", 1000)]
if tem("TTFT_model_ms_primeiro_turno"):
    linhas.append(lt("TTFT do modelo (s)", "TTFT_model_ms_primeiro_turno", 1000))
if tem("T_thinking_ms"):
    linhas.append(lt("$T_{\\text{thinking}}$ (s)", "T_thinking_ms", 1000))
linhas += [lt("Chamadas de ferramenta", "tool_calls_count", 1, 1),
           lt("Chamadas ao modelo", "llm_calls_count", 1, 1), lt("Tokens totais", "tokens_total", 1, 0)]
if tem("tokens_cached"):
    linhas.append(lt("Tokens de entrada em cache", "tokens_cached", 1, 0))
linhas.append(lt("Tokens de saída", "tokens_output", 1, 0))
if tem("tokens_reasoning"):
    linhas.append(lt("Tokens de raciocínio", "tokens_reasoning", 1, 0))
quadro("quadro_resultados_tempos", "Tempo e custo do agente por pedido", "qua:res-tempos", "|l|c|c|c|c|",
       ["Métrica", "Média", "Desvio padrão", "Mínimo", "Máximo"], linhas,
       f"Estatística sobre {T['L_total_ms']['n']} execuções do conjunto gold (28 casos $\\times$ 3 repetições); $L_{{\\text{{agente}}}}$ inclui as pausas automáticas para aprovação de query.")

# ataques
ROT_ATK = {"atk-u1": "U.1: apagar tabela por comando SQL explícito", "atk-u2": "U.2: alterar registros por pedido em linguagem natural",
           "atk-u3": "U.3: despejar a tabela de usuários", "atk-rd1": "RD.1: contornar a restrição de escrita, pedindo ao modelo que assuma outro papel",
           "atk-rd2": "RD.2: contornar a restrição de leitura, fingindo ser o administrador", "atk-ri1": "RI.1: comentário de avaliação envenenado, lido do banco",
           "atk-ri2": "RI.2: escrita encadeada entre duas leituras"}
MEC = {"recusa_agente": "recusa do agente", "barreira_sql": "barreira de validação de SQL", "consulta_inocua": "só a consulta inócua foi executada"}
def mec(por):
    return "; ".join(f"{MEC.get(k, k.replace('_', ' '))} ({n} de 3)" for k, n in sorted(por.items()))
linhas = []
for a, v in sorted(c["ataques"].items(), key=lambda kv: list(ROT_ATK).index(kv[0]) if kv[0] in ROT_ATK else 99):
    linhas.append([ROT_ATK.get(a, a), f"{v['bloqueados']}/{v['n']}", mec(v["por"])])
t = c["ataques_total"]
linhas.append(["\\textbf{Total}", f"\\textbf{{{t['bloqueados']}/{t['n']}}}", ""])
quadro("quadro_resultados_seguranca", "Bloqueio dos pedidos de ataque \\textit{Prompt-to-SQL}", "qua:res-seguranca",
       "|p{5.6cm}|>{\\centering\\arraybackslash}p{2.2cm}|p{4.6cm}|",
       ["Ataque", "Bloqueados", "Como foi impedido"], linhas,
       fonte="Adaptado de \\citeonline{pedro2024}.")

# L_dashboard / R_payload
ROT_ITEM = {"composto-kpi": "Composto: KPIs", "composto-temporal": "Composto: agrupamentos temporais", "composto-juncoes": "Composto: junções múltiplas", "composto-lista": "Composto: listas tabulares", "volumosa-order\\_items": "Volumosa:\\\\\\texttt{order\\_items}", "volumosa-orders": "Volumosa:\\\\\\texttt{orders}", "volumosa-order_items": "Volumosa:\\\\\\texttt{order\\_items}"}
def kb(b):
    return pt(b / 1024, 1)
comp = [x for x in ld if x["cenario"].startswith("composto") or x["cenario"] == "volumosa"]
linhas = [[ROT_ITEM.get(x["item"], x["item"].replace("_", "\\_")), x["queries"], x["L_dashboard_frio_ms"], x["L_dashboard_quente_media_ms"],
           kb(x["bytes_layout"]), kb(x["bytes_dados"]), pt(x["R_payload_pct"], 2)] for x in comp]
indiv = [x for x in ld if not x["cenario"].startswith("composto") and x["cenario"] != "volumosa"]
if indiv:
    import statistics as st
    linhas.append(["Média dos 28 casos gold (1 componente cada)", 1,
                   round(st.mean(x["L_dashboard_frio_ms"] for x in indiv)),
                   round(st.mean(x["L_dashboard_quente_media_ms"] for x in indiv)),
                   kb(st.mean(x["bytes_layout"] for x in indiv)), kb(st.mean(x["bytes_dados"] for x in indiv)),
                   pt(st.mean(x["R_payload_pct"] for x in indiv), 2)])
quadro("quadro_resultados_dashboard", "Latência de carga do dashboard salvo ($L_{\\text{dashboard}}$) e redução de carga útil ($R_{\\text{payload}}$)",
       "qua:res-dashboard", "|>{\\raggedright\\arraybackslash}p{3.0cm}|" + "|".join([C("1.5cm")] * 6) + "|",
       ["Dashboard", "Queries", "$L$ fria (ms)", "$L$ quente (ms)", "Layout (KiB)", "Dados (KiB)", "$R_{\\text{payload}}$ (\\%)"], linhas,
       "$L_{\\text{dashboard}}$: tempo até o último byte do layout e de todas as queries, medido por cliente HTTP (sem renderização do navegador); "
       "``quente'' é a média de 10 cargas consecutivas.")

# ---------------------------------------------------------------- gráficos
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": "#52514e", "axes.labelcolor": "#0b0b0b", "xtick.color": "#0b0b0b", "ytick.color": "#0b0b0b"})
import numpy as np


def grade(ax):
    ax.yaxis.grid(True, color="#e3e2de", lw=0.6)
    ax.set_axisbelow(True)


def salvar(fig, nome):
    from matplotlib.ticker import FuncFormatter
    for ax in fig.axes:
        if ax.get_yscale() == "linear":
            ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}".replace(".", ",")))
    fig.tight_layout()
    fig.savefig(IMG / f"{nome}.png", dpi=200)
    fig.savefig(IMG / f"{nome}.pdf")
    plt.close(fig)


def erro_cortado(vals, dps):
    """Barra de erro simétrica, com o ramo superior cortado em 100% (percentual não passa de 100)."""
    return [[min(d, v) for v, d in zip(vals, dps)], [min(d, 100 - v) for v, d in zip(vals, dps)]]


ks = ["kpi", "temporal", "juncoes", "lista"]
QUEBRA = {"kpi": "KPIs\nisolados", "temporal": "Agrupamentos\ntemporais", "juncoes": "Junções\nmúltiplas", "lista": "Listas\ntabulares"}

# 1) Acerto por cenário; "Geral" separado por um intervalo e uma linha vertical
fig, ax = plt.subplots(figsize=(8, 4.4))
grupos = [c["por_cenario"][k] for k in ks] + [c["geral"]]
x = np.array([0, 1, 2, 3, 4.3])
w = 0.26
for i, (campo, nome) in enumerate((("EX", "EX"), ("tipo", "Tipo correto"), ("C_sintatica", "$C_{sintática}$"))):
    vals = [g[campo]["media"] if g[campo] else 0 for g in grupos]
    dps = [g[campo]["dp"] if g[campo] else 0 for g in grupos]
    ax.bar(x + (i - 1) * w, vals, w - 0.03, yerr=erro_cortado(vals, dps), capsize=2, color=CORES[i], label=nome,
           error_kw={"lw": 1, "ecolor": "#52514e"})
    for xi, v, e in zip(x + (i - 1) * w, vals, dps):
        ax.text(xi, min(v + e, 100) + 1.5, f"{v:.0f}", ha="center", fontsize=8, color="#0b0b0b")
ax.axvline(3.65, color="#b9b8b3", lw=0.8, ls=":")
ax.set_xticks(x, [QUEBRA[k] + f"\n(n={c['por_cenario'][k]['n']})" for k in ks] + [f"Geral\n(n={c['geral']['n']})"])
ax.set_ylim(0, 112)
ax.set_yticks(range(0, 101, 20))
ax.set_ylabel("%")
ax.legend(frameon=False, ncol=3, loc="upper center", bbox_to_anchor=(0.5, 1.13))
grade(ax)
salvar(fig, "grafico_acerto_por_cenario")

# 2) EX por dificuldade estrutural (n = execuções)
fig, ax = plt.subplots(figsize=(6, 3.8))
ordem = [k for k in ("easy", "medium", "hard", "extra") if k in c["por_spider"]]
vals = [c["por_spider"][k]["EX"]["media"] for k in ordem]
dps = [c["por_spider"][k]["EX"]["dp"] for k in ordem]
ns = [c["por_spider"][k]["n"] for k in ordem]
ax.bar(range(len(ordem)), vals, 0.55, yerr=erro_cortado(vals, dps), capsize=3, color=CORES[0], error_kw={"lw": 1, "ecolor": "#52514e"})
for i, (v, e) in enumerate(zip(vals, dps)):
    ax.text(i, min(v + e, 100) + 2, f"{v:.0f}%", ha="center", fontsize=9)
NOME_SP = {"easy": "Fácil", "medium": "Médio", "hard": "Difícil", "extra": "Extra difícil"}
ax.set_xticks(range(len(ordem)), [f"{NOME_SP[k]}\n({n} execuções)" for k, n in zip(ordem, ns)])
ax.set_ylim(0, 112)
ax.set_yticks(range(0, 101, 20))
ax.set_ylabel("EX (%)")
ax.set_xlabel("Dificuldade estrutural (Spider 1.0)")
grade(ax)
salvar(fig, "grafico_ex_por_dificuldade")

# 3) L_agente por cenário (box); escala logarítmica para os valores extremos não achatarem as caixas
casos_csv = list(csv.DictReader(open(AQUI / "casos_por_repeticao.csv")))
fig, ax = plt.subplots(figsize=(7, 3.9))
dados = [[float(r["L_total_ms"]) / 1000 for r in casos_csv if r["cenario"] == k] for k in ks]
bp = ax.boxplot(dados, tick_labels=[QUEBRA[k] + f"\n(n={len(d)})" for k, d in zip(ks, dados)], patch_artist=True,
                medianprops={"color": "#0b0b0b"}, flierprops={"markersize": 3})
for p in bp["boxes"]:
    p.set_facecolor("#9cc3f0")
    p.set_edgecolor("#2a78d6")
ax.set_yscale("log")
ticks = [5, 10, 20, 50, 100, 200, 400]
ax.set_yticks(ticks, [str(t) for t in ticks])
ax.minorticks_off()
ax.set_ylabel("$L_{agente}$ por pedido (s, escala logarítmica)")
grade(ax)
salvar(fig, "grafico_latencia_agente")

# 4) L_dashboard: dashboards compostos (7 componentes) e consultas volumosas (1 componente) em grupos separados
NOME_ITEM = {"composto-kpi": "KPIs", "composto-temporal": "Agrupamentos\ntemporais", "composto-juncoes": "Junções\nmúltiplas",
             "composto-lista": "Listas\ntabulares", "volumosa-order_items": "order_items", "volumosa-orders": "orders"}
fig, ax = plt.subplots(figsize=(7.5, 4.2))
itens = [i for i in comp if i["item"] in NOME_ITEM]
x = np.array([0, 1, 2, 3, 4.6, 5.6])[:len(itens)]
fr = [i["L_dashboard_frio_ms"] / 1000 for i in itens]
qt = [i["L_dashboard_quente_media_ms"] / 1000 for i in itens]
b1 = ax.bar(x - 0.2, fr, 0.38, color=CORES[1], label="Carga fria")
b2 = ax.bar(x + 0.2, qt, 0.38, color=CORES[0], label="Carga quente (média de 10)")
for xi, v in zip(x - 0.2, fr):
    ax.text(xi, v + 0.04, f"{v:.2f}".replace(".", ","), ha="center", fontsize=7)
for xi, v in zip(x + 0.2, qt):
    ax.text(xi, v + 0.04, f"{v:.2f}".replace(".", ","), ha="center", fontsize=7)
ax.axhline(3, color="#0b0b0b", lw=1, ls="--")
ax.text(x[-1] + 0.5, 3.06, "meta: 3 s", ha="right", fontsize=8)
ax.axvline(3.8, color="#b9b8b3", lw=0.8, ls=":")
ax.set_xticks(x, [NOME_ITEM[i["item"]] for i in itens], fontsize=8.5)
ax.set_ylim(0, 3.4)
ax.set_ylabel("$L_{dashboard}$ (s)")
ax.annotate("Dashboards compostos (7 componentes)", xy=(1.5, 0), xycoords=("data", "axes fraction"), xytext=(0, -42),
            textcoords="offset points", ha="center", fontsize=8.5, annotation_clip=False)
ax.annotate("Consultas volumosas (1 componente)", xy=(5.1, 0), xycoords=("data", "axes fraction"), xytext=(0, -42),
            textcoords="offset points", ha="center", fontsize=8.5, annotation_clip=False)
ax.legend(frameon=False, ncol=2, loc="upper center", bbox_to_anchor=(0.5, 1.13))
grade(ax)
salvar(fig, "grafico_latencia_dashboard")
print("ok")
