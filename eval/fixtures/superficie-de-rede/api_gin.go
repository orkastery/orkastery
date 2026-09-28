// Fixture DELIBERADAMENTE vulneravel (SP8..SP12), sem valor de producao.
package exemplo

import "github.com/gin-gonic/gin"

func Rotas() *gin.Engine {
	r := gin.Default()

	// SP9: pprof aberto em producao entrega perfil e memoria do processo.
	r.GET("/debug/pprof", handlerPprof)

	// SP8 + SP12: cobranca alterada por payload cru, sem guarda e sem binding.
	r.POST("/clientes/:id/cobranca", func(c *gin.Context) {
		atualizarCobranca(c.Param("id"), lerCorpo(c))
	})

	return r
}
