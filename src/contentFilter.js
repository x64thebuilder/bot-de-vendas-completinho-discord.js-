const CATEGORIES = [
  {
    label: "exploracao infantil",
    severity: "critical",
    terms: [
      "pedofilia", "pornografia infantil", "conteudo infantil sexual",
      "nudes de menor", "csam", "cp infantil"
    ]
  },
  {
    label: "fraude, dados roubados e contas invadidas",
    severity: "normal",
    terms: [
      "cartao clonado", "cartao de credito clonado", "cc fullz", "fullz",
      "cvv roubado", "conta hackeada", "conta invadida", "conta roubada",
      "dados vazados", "vazamento de senha", "senha roubada", "cpf vazado",
      "documento roubado", "identidade roubada", "golpe pix", "lavagem de dinheiro"
    ]
  },
  {
    label: "falsificacao",
    severity: "normal",
    terms: [
      "dinheiro falso", "nota falsa", "cedula falsa", "documento falso",
      "identidade falsa", "rg falso", "passaporte falso", "diploma falso",
      "carteira de habilitacao falsa", "cnh falsa"
    ]
  }
];
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function checkProhibitedContent(...texts) {
  const combined = normalize(texts.join(" \n "));
  for (const category of CATEGORIES) {
    for (const term of category.terms) {
      if (combined.includes(normalize(term))) {
        return { blocked: true, label: category.label, term, severity: category.severity };
      }
    }
  }
  return { blocked: false };
}
function prohibitedContentMessage(result) {
  return `Este produto nao pode ser cadastrado: o nome ou a descricao parece se enquadrar em **${result.label}**, categoria que este bot nao permite anunciar. Ajuste o texto e tente novamente.`;
}
module.exports = {
  checkProhibitedContent,
  prohibitedContentMessage
};
