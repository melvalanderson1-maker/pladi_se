# rag_service.py - Cambia esta línea para alternar entre OpenAI y Claude


#from services.rag_service_openai import answer_question_stream, answer_question

#from services.rag_service_claude import answer_question_stream, answer_question    


from services.rag_service_groq import answer_question_stream, answer_question